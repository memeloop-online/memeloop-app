import { describe, expect, it } from 'vitest';

import { createProviderModel } from '../callProviderAPI';
import { normalizeOpenAIBaseURL } from '../openAIBaseURL';

describe('OpenAI-compatible model API mode', () => {
  const provider = {
    provider: 'cpa-test',
    providerClass: 'openAICompatible',
    baseURL: 'https://models.example.test/v1',
    apiKey: 'unit-test-secret',
    models: [],
  };

  it.each(
    [
      ['chat-completions', 'cpa-test.chat'],
      ['responses', 'openai.responses'],
    ] as const,
  )('selects the %s model transport', (apiMode, expectedProvider) => {
    const model = createProviderModel(provider, { name: 'mixed-model', apiMode });

    expect(model.provider).toBe(expectedProvider);
    expect(model.modelId).toBe('mixed-model');
  });

  it.each([
    ['https://models.example.test', 'https://models.example.test/v1'],
    ['https://models.example.test/v1/', 'https://models.example.test/v1'],
  ])('normalizes %s without double-appending /v1', (input, expected) => {
    expect(normalizeOpenAIBaseURL(input)).toBe(expected);
  });
});
