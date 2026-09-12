import { getLocalAuthStore, type LocalAuthStore } from '@services/libs/authFileStore';
import type { ProviderAccountConfig } from 'memeloop';

import type { ProviderRuntimeConfig } from './runtimeTypes';

/**
 * Resolve canonical account secret references through the app-local auth file.
 * Plaintext API keys are accepted only as call-scoped input and are never
 * copied into ProviderAccountConfig or renderer-facing account projections.
 */
export class SecretResolver {
  constructor(private readonly authStore: LocalAuthStore = getLocalAuthStore()) {}

  prepareProviderUpdate(
    account: ProviderAccountConfig,
    apiKey: string | undefined,
    existingSecretReference?: string,
  ): ProviderAccountConfig {
    // Account edits such as adding a model do not carry an API key. Keep the
    // existing opaque reference so those edits cannot silently disconnect an
    // otherwise configured provider.
    if (apiKey === undefined) {
      return account.secretRef === undefined && existingSecretReference !== undefined
        ? { ...account, secretRef: existingSecretReference }
        : account;
    }
    const providerId = account.providerId;
    const normalizedApiKey = apiKey.trim();
    const secretReference = existingSecretReference ?? `ai-provider/${providerId}`;
    if (!normalizedApiKey) {
      this.authStore.delete(secretReference);
      const { secretRef: _secretReference, ...withoutSecret } = account;
      return withoutSecret;
    }
    this.authStore.set(secretReference, normalizedApiKey);
    return { ...account, secretRef: secretReference };
  }

  deleteProviderSecret(providerId: string): void {
    this.authStore.delete(`ai-provider/${providerId}`);
  }

  resolveProvider(account: Readonly<ProviderAccountConfig>): ProviderRuntimeConfig {
    const apiKey = account.secretRef === undefined
      ? undefined
      : this.authStore.get(account.secretRef);
    return apiKey === undefined ? { account } : { account, apiKey };
  }
}
