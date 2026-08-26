import { describe, expect, it } from 'vitest';

import type { ModelCatalog } from 'memeloop/model-catalog';
import { providerConfigsFromModelCatalog } from '../modelCatalog';

const catalog: ModelCatalog = {
  schemaVersion: 1,
  source: 'https://models.dev/api.json',
  catalogVersion: 'test-v1',
  fetchedAt: '2026-08-24T00:00:00.000Z',
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      api: 'https://api.openai.com/v1',
      env: ['OPENAI_API_KEY'],
      models: [
        {
          id: 'gpt-test',
          name: 'GPT Test',
          attachment: true,
          reasoning: true,
          toolCall: true,
          structuredOutput: true,
          modalities: { input: ['text', 'image'], output: ['text'] },
          limit: { context: 1_000_000, output: 128_000 },
        },
      ],
    },
    {
      id: 'new-compatible-provider',
      name: 'New Provider',
      api: 'https://new.example/v1',
      env: ['NEW_API_KEY'],
      models: [
        {
          id: 'new-model',
          name: 'New Model',
          attachment: false,
          reasoning: false,
          toolCall: false,
        },
      ],
    },
  ],
};

describe('portable Core model catalog adapter', () => {
  it('maps current catalog capabilities and limits without a copied model list', () => {
    const providers = providerConfigsFromModelCatalog(catalog);
    const openAI = providers.find(provider => provider.provider === 'openai');

    expect(openAI).toMatchObject({
      providerClass: 'openai',
      isPreset: true,
    });
    expect(openAI?.models).toEqual([
      expect.objectContaining({
        name: 'gpt-test',
        caption: 'GPT Test',
        features: ['language', 'reasoning', 'toolCalling', 'vision'],
        contextWindowSize: 1_000_000,
        maxOutputTokens: 128_000,
      }),
    ]);
  });

  it('makes newly discovered HTTP providers available as OpenAI-compatible presets', () => {
    expect(providerConfigsFromModelCatalog(catalog)).toContainEqual(
      expect.objectContaining({
        provider: 'new-compatible-provider',
        providerClass: 'openAICompatible',
        baseURL: 'https://new.example/v1',
        showBaseURLField: true,
      }),
    );
  });

  it('retains MemeLoop-specific providers absent from models.dev', () => {
    expect(providerConfigsFromModelCatalog(catalog).some(provider => provider.provider === 'memeloop')).toBe(true);
  });
});
