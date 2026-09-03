import { safeStorage } from 'electron';

import type { IDatabaseService } from '@services/database/interface';
import { logger } from '@services/libs/log';
import type { ProviderAccountConfig } from 'memeloop';

import type { ProviderRuntimeConfig } from './runtimeTypes';

type PersistedSecrets = Record<string, string>;

/**
 * Resolve canonical account secret references through OS-backed storage.
 * Plaintext API keys are accepted only as call-scoped input and are never
 * copied into ProviderAccountConfig or renderer-facing account projections.
 */
export class SecretResolver {
  private readonly secrets: PersistedSecrets;
  private changed = false;

  constructor(private readonly databaseService: IDatabaseService) {
    const stored = databaseService.getSetting('aiProviderSecrets');
    this.secrets = stored && typeof stored === 'object' ? { ...stored } : {};
  }

  prepareProviderUpdate(
    account: ProviderAccountConfig,
    apiKey: string | undefined,
    existingSecretReference?: string,
  ): ProviderAccountConfig {
    if (apiKey === undefined) return account;
    const providerId = account.providerId;
    const normalizedApiKey = apiKey.trim();
    const secretReference = existingSecretReference ?? `ai-provider/${providerId}`;
    if (!normalizedApiKey) {
      if (this.secrets[secretReference] !== undefined) {
        delete this.secrets[secretReference];
        this.changed = true;
      }
      const { secretRef: _secretReference, ...withoutSecret } = account;
      return withoutSecret;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('secure_storage_unavailable');
    }
    this.secrets[secretReference] = safeStorage.encryptString(normalizedApiKey).toString('base64');
    this.changed = true;
    return { ...account, secretRef: secretReference };
  }

  persist(): void {
    if (!this.changed) return;
    this.databaseService.setSetting('aiProviderSecrets', this.secrets);
    this.changed = false;
  }

  deleteProviderSecret(providerId: string): void {
    const secretReference = `ai-provider/${providerId}`;
    if (this.secrets[secretReference] !== undefined) {
      delete this.secrets[secretReference];
      this.changed = true;
    }
  }

  resolveProvider(account: Readonly<ProviderAccountConfig>): ProviderRuntimeConfig {
    const apiKey = account.secretRef === undefined
      ? undefined
      : this.decrypt(account.secretRef);
    return apiKey === undefined ? { account } : { account, apiKey };
  }

  private decrypt(secretReference: string): string | undefined {
    const encrypted = this.secrets[secretReference];
    if (!encrypted) return undefined;
    if (!safeStorage.isEncryptionAvailable()) {
      logger.warn('Provider secret is configured but secure storage is unavailable', { secretRef: secretReference });
      return undefined;
    }
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch (error) {
      logger.warn('Failed to decrypt provider secret', { secretRef: secretReference, error });
      return undefined;
    }
  }
}
