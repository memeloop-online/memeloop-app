import type { ModelCatalog } from 'memeloop/model-catalog';
import { describe, expect, it } from 'vitest';
import { providerAccountsFromModelCatalog } from '../modelCatalog';

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
      models: [{
        id: 'gpt-test',
        name: 'GPT Test',
        attachment: true,
        reasoning: true,
        toolCall: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
        limit: { context: 1_000_000, output: 128_000 },
      }],
    },
    {
      id: 'new-compatible-provider',
      name: 'New Provider',
      api: 'https://new.example/v1',
      env: ['NEW_API_KEY'],
      models: [{ id: 'new-model', name: 'New Model', attachment: false, reasoning: false, toolCall: false }],
    },
  ],
};

describe('portable Core model catalog adapter', () => {
  it('maps catalog providers to canonical accounts and routes', () => {
    const accounts = providerAccountsFromModelCatalog(catalog);
    const openAI = accounts.find(account => account.providerId === 'openai');
    expect(openAI).toMatchObject({ providerId: 'openai', providerType: 'openai', baseUrl: 'https://api.openai.com/v1', enabled: false });
    expect(openAI?.models).toEqual([{ modelId: 'gpt-test', wireModelId: 'gpt-test', apiMode: 'chat-completions', requestDefaults: { maxOutputTokens: 128_000 } }]);
    expect(openAI?.catalogProvider?.models[0].name).toBe('GPT Test');
  });

  it('keeps discovered providers as canonical accounts', () => {
    const account = providerAccountsFromModelCatalog(catalog).find(candidate => candidate.providerId === 'new-compatible-provider');
    expect(account).toMatchObject({
      providerId: 'new-compatible-provider',
      providerType: 'new-compatible-provider',
      baseUrl: 'https://new.example/v1',
      models: [{ modelId: 'new-model' }],
    });
  });

  it('retains MemeLoop-specific accounts absent from the catalog', () => {
    expect(providerAccountsFromModelCatalog(catalog).some(account => account.providerId === 'memeloop')).toBe(true);
  });
});
