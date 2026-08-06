import type { AiAPIConfig } from '@services/agentInstance/promptConcat/promptConcatSchema/types';
import type { AIProviderConfig } from '@services/providerRegistry/interface';
import { describe, expect, it } from 'vitest';

import { createProviderStreamOptions } from '../callProviderAPI';

describe('provider generation settings', () => {
  const provider: AIProviderConfig = {
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
  )('builds AI SDK options with model defaults for %s', (apiMode, expectedProvider) => {
    const model = {
      name: `${apiMode}-model`,
      apiMode,
      maxOutputTokens: 32_768,
      modelOptions: { top_p: 0.95 },
    } as const;
    const config = {
      default: { provider: provider.provider, model: model.name },
      modelParameters: {},
    } satisfies AiAPIConfig;

    const options = createProviderStreamOptions(
      config,
      [{ role: 'user', content: 'hello' }],
      new AbortController().signal,
      { ...provider, models: [model] },
    );

    expect(options).toEqual(expect.objectContaining({
      maxOutputTokens: 32_768,
      topP: 0.95,
      model: expect.objectContaining({ provider: expectedProvider }),
    }));
  });

  it('builds AI SDK options with explicit request overrides', () => {
    const model = {
      name: 'override-model',
      apiMode: 'responses' as const,
      maxOutputTokens: 32_768,
      modelOptions: { top_p: 0.95 },
    };
    const config = {
      default: { provider: provider.provider, model: model.name },
      modelParameters: { maxTokens: 1024, topP: 0.25 },
    } satisfies AiAPIConfig;

    const options = createProviderStreamOptions(
      config,
      [{ role: 'user', content: 'hello' }],
      new AbortController().signal,
      { ...provider, models: [model] },
    );

    expect(options).toEqual(expect.objectContaining({
      maxOutputTokens: 1024,
      topP: 0.25,
      model: expect.objectContaining({ provider: 'openai.responses' }),
    }));
  });
});
