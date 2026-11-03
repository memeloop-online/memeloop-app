import { container } from '@services/container';
import type { AIStreamResponse, IProviderRegistryService, ProviderAccountConfig } from '@services/providerRegistry/interface';
import serviceIdentifier from '@services/serviceIdentifier';
import { afterEach, describe, expect, it } from 'vitest';

describe('ProviderRegistryService production entrypoint', () => {
  const service = container.get<IProviderRegistryService>(serviceIdentifier.ProviderRegistry);
  const account: ProviderAccountConfig = {
    providerId: 'registry-entry-test',
    providerType: 'openAICompatible',
    baseUrl: 'https://models.example.test/v1',
    enabled: true,
    models: [{ modelId: 'responses-model', wireModelId: 'responses-model', apiMode: 'responses' }],
  };

  afterEach(async () => {
    await service.deleteProvider(account.providerId);
  });

  it('routes a configured model through the registry service before provider transport', async () => {
    await service.updateProvider(account);
    const events: AIStreamResponse[] = [];
    for await (
      const event of service.generateFromAI(
        [{ role: 'user', content: 'hello' }],
        { default: { providerId: account.providerId, modelId: 'responses-model' } },
      )
    ) {
      events.push(event);
    }
    expect(events.at(-1)).toMatchObject({ status: 'error' });
  });
});
