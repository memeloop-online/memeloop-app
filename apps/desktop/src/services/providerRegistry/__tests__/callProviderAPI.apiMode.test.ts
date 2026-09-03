import type { ModelAssignments, ProviderModelRoute } from 'memeloop';
import { describe, expect, it } from 'vitest';
import { createProviderModel, resolveModelGenerationSettings } from '../callProviderAPI';
import { normalizeOpenAIBaseURL } from '../openAIBaseURL';

const provider = {
  account: {
    providerId: 'cpa-test',
    providerType: 'openAICompatible',
    baseUrl: 'https://models.example.test/v1',
    enabled: true,
    models: [],
  },
  apiKey: 'unit-test-secret',
};

describe('OpenAI-compatible model API mode', () => {
  it.each(['chat-completions', 'responses'] as const)('selects the %s model transport', apiMode => {
    const route: ProviderModelRoute = { modelId: 'mixed-model', wireModelId: 'mixed-wire-model', apiMode };
    const model = createProviderModel(provider, route);
    expect(model.modelId).toBe('mixed-wire-model');
  });

  it.each([
    ['https://models.example.test', 'https://models.example.test'],
    ['https://models.example.test/v1/', 'https://models.example.test/v1'],
    ['  https://models.example.test/v1///  ', 'https://models.example.test/v1'],
  ])('trims %s without appending an API version path', (input, expected) => {
    expect(normalizeOpenAIBaseURL(input)).toBe(expected);
  });

  it('uses route generation defaults when assignment parameters are absent', () => {
    const config: ModelAssignments = { default: { providerId: 'cpa-test', modelId: 'mixed-model' } };
    const route: ProviderModelRoute = {
      modelId: 'mixed-model',
      wireModelId: 'mixed-model',
      apiMode: 'chat-completions',
      requestDefaults: { maxOutputTokens: 32768, topP: 0.95 },
    };
    expect(resolveModelGenerationSettings(config, route)).toEqual({ maxOutputTokens: 32768, topP: 0.95 });
  });

  it('gives assignment parameters precedence over route defaults', () => {
    const config: ModelAssignments = {
      default: { providerId: 'cpa-test', modelId: 'mixed-model', parameters: { maxOutputTokens: 4096, topP: 0.4 } },
    };
    const route: ProviderModelRoute = {
      modelId: 'mixed-model',
      wireModelId: 'mixed-model',
      apiMode: 'chat-completions',
      requestDefaults: { maxOutputTokens: 32768, topP: 0.95 },
    };
    expect(resolveModelGenerationSettings(config, route)).toEqual({ maxOutputTokens: 4096, topP: 0.4 });
  });
});
