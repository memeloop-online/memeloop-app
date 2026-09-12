import type { IDatabaseService } from '@services/database/interface';
import { describe, expect, it, vi } from 'vitest';

import { SecretResolver } from '../secretResolver';

describe('SecretResolver initialization', () => {
  it('does not read settings until the database-backed service is initialized', () => {
    const getSetting = vi.fn(() => undefined);
    const resolver = new SecretResolver({ getSetting } as unknown as IDatabaseService);

    expect(getSetting).not.toHaveBeenCalled();
    resolver.initialize();
    resolver.initialize();

    expect(getSetting).toHaveBeenCalledOnce();
    expect(getSetting).toHaveBeenCalledWith('aiProviderSecrets');
  });

  it('retains an existing secret reference when an account-only update omits the API key', () => {
    const resolver = new SecretResolver({ getSetting: vi.fn() } as unknown as IDatabaseService);
    resolver.initialize();
    const account = {
      providerId: 'configured-provider',
      providerType: 'openAICompatible',
      models: [],
    };

    const configured = resolver.prepareProviderUpdate(account, 'test-secret');
    const updated = resolver.prepareProviderUpdate(
      { ...account, models: [{ modelId: 'gpt-5.6-luna', wireModelId: 'gpt-5.6-luna', apiMode: 'responses' as const }] },
      undefined,
      configured.secretRef,
    );

    expect(updated.secretRef).toBe('ai-provider/configured-provider');
  });
});
