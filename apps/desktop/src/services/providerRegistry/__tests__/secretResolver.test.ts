import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { IDatabaseService } from '@services/database/interface';
import { LocalAuthStore } from '@services/libs/authFileStore';
import type { ProviderAccountConfig, ProviderAccountSettings } from 'memeloop';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountStore } from '../accountStore';
import { SecretResolver } from '../secretResolver';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('provider credentials', () => {
  it('keeps secret metadata through account edits while storing the plaintext only in auth.json', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'memeloop-provider-auth-'));
    temporaryDirectories.push(directory);
    const authStore = new LocalAuthStore(path.join(directory, 'auth.json'));
    const settings = new Map<string, unknown>();
    const databaseService = {
      getSetting: vi.fn((key: string) => settings.get(key)),
      setSetting: vi.fn((key: string, value: unknown) => settings.set(key, value)),
    } as unknown as IDatabaseService;
    const accountStore = new AccountStore(databaseService, new SecretResolver(authStore));
    const account: ProviderAccountConfig = {
      providerId: 'configured-provider',
      providerType: 'openAICompatible',
      models: [],
    };

    await accountStore.updateProvider(account, 'test-provider-key');

    const configured = accountStore.getProviderAccounts().at(0);
    expect(configured?.secretRef).toBe('ai-provider/configured-provider');
    expect(JSON.stringify(settings.get('aiSettings'))).not.toContain('test-provider-key');
    expect(authStore.get('ai-provider/configured-provider')).toBe('test-provider-key');
    expect(accountStore.getProvider('configured-provider')?.apiKey).toBe('test-provider-key');

    await accountStore.updateProvider({
      ...account,
      models: [{ modelId: 'gpt-5.6-luna', wireModelId: 'gpt-5.6-luna', apiMode: 'responses' }],
    });

    expect(accountStore.getProviderAccounts().at(0)?.secretRef).toBe('ai-provider/configured-provider');
    expect(authStore.get('ai-provider/configured-provider')).toBe('test-provider-key');

    await accountStore.deleteProvider('configured-provider');
    expect(authStore.get('ai-provider/configured-provider')).toBeUndefined();
    expect((settings.get('aiSettings') as ProviderAccountSettings).accounts).toEqual([]);
  });
});
