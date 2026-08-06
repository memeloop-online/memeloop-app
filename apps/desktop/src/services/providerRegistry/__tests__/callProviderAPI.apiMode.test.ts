import { describe, expect, it } from 'vitest';

import type { AiAPIConfig } from '@services/agentInstance/promptConcat/promptConcatSchema/types';
import { createProviderModel, resolveModelGenerationSettings } from '../callProviderAPI';
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
    ['https://models.example.test', 'https://models.example.test'],
    ['https://models.example.test/v1/', 'https://models.example.test/v1'],
    ['  https://models.example.test/v1///  ', 'https://models.example.test/v1'],
  ])('trims %s without appending an API version path', (input, expected) => {
    expect(normalizeOpenAIBaseURL(input)).toBe(expected);
  });

  it('uses model generation defaults when request parameters are absent', () => {
    const config = { default: { provider: 'cpa-test', model: 'mixed-model' }, modelParameters: {} } satisfies AiAPIConfig;

    expect(resolveModelGenerationSettings(config, {
      name: 'mixed-model',
      maxOutputTokens: 32_768,
      modelOptions: { top_p: 0.95 },
    })).toEqual({ maxOutputTokens: 32_768, topP: 0.95 });
  });

  it('gives explicit request parameters precedence over model defaults', () => {
    const config = {
      default: { provider: 'cpa-test', model: 'mixed-model' },
      modelParameters: { maxOutputTokens: 4096, maxTokens: 2048, topP: 0.4 },
    } satisfies AiAPIConfig;

    expect(resolveModelGenerationSettings(config, {
      name: 'mixed-model',
      maxOutputTokens: 32_768,
      modelOptions: { top_p: 0.95 },
    })).toEqual({ maxOutputTokens: 4096, topP: 0.4 });
  });

  it('supports the legacy explicit maxTokens request alias', () => {
    const config = {
      default: { provider: 'cpa-test', model: 'mixed-model' },
      modelParameters: { maxTokens: 2048 },
    } satisfies AiAPIConfig;

    expect(
      resolveModelGenerationSettings(config, {
        name: 'mixed-model',
        maxOutputTokens: 32_768,
      }).maxOutputTokens,
    ).toBe(2048);
  });
});
