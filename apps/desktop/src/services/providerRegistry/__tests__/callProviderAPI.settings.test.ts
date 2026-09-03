import type { ModelAssignments, ProviderAccountConfig, ProviderModelRoute } from 'memeloop';
import { describe, expect, it } from 'vitest';
import { createProviderStreamOptions } from '../callProviderAPI';

const account: ProviderAccountConfig = {
  providerId: 'cpa-test',
  providerType: 'openAICompatible',
  baseUrl: 'https://models.example.test/v1',
  enabled: true,
  models: [],
};

describe('provider generation settings', () => {
  it.each(['chat-completions', 'responses'] as const)('builds AI SDK options with route defaults for %s', apiMode => {
    const route: ProviderModelRoute = {
      modelId: `${apiMode}-model`,
      wireModelId: `${apiMode}-wire-model`,
      apiMode,
      requestDefaults: { maxOutputTokens: 32768, topP: 0.95 },
    };
    const config: ModelAssignments = { default: { providerId: account.providerId, modelId: route.modelId } };
    const options = createProviderStreamOptions(config, [{ role: 'user', content: 'hello' }], new AbortController().signal, {
      account: { ...account, models: [route] },
      apiKey: 'unit-test-secret',
    });
    expect(options).toEqual(expect.objectContaining({ maxOutputTokens: 32768, topP: 0.95 }));
  });

  it('builds AI SDK options with explicit assignment overrides', () => {
    const route: ProviderModelRoute = {
      modelId: 'override-model',
      wireModelId: 'override-wire-model',
      apiMode: 'responses',
      requestDefaults: { maxOutputTokens: 32768, topP: 0.95 },
    };
    const config: ModelAssignments = {
      default: { providerId: account.providerId, modelId: route.modelId, parameters: { maxOutputTokens: 1024, topP: 0.25 } },
    };
    const options = createProviderStreamOptions(config, [{ role: 'user', content: 'hello' }], new AbortController().signal, {
      account: { ...account, models: [route] },
      apiKey: 'unit-test-secret',
    });
    expect(options).toEqual(expect.objectContaining({ maxOutputTokens: 1024, topP: 0.25 }));
  });
});
