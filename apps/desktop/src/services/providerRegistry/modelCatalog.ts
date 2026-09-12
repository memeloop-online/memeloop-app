import { EMBEDDED_MODEL_CATALOG, type ModelCatalog, type ModelCatalogProvider, type ProviderAccountConfig, type ProviderModelRoute } from 'memeloop';

/**
 * App-owned accounts which are not published by models.dev.  The catalog
 * remains the source of truth for every published provider; these two local
 * accounts only describe host features (cloud and ComfyUI) that cannot be
 * discovered from the upstream catalog.
 */
const APP_SPECIFIC_PROVIDER_ACCOUNTS: readonly ProviderAccountConfig[] = [
  {
    providerId: 'memeloop',
    providerType: 'memeloop',
    baseUrl: 'https://api.memeloop.dev',
    enabled: false,
    models: [
      {
        modelId: 'memeloop-default',
        wireModelId: 'memeloop-default',
        apiMode: 'chat-completions',
      },
      {
        modelId: 'memeloop-embedding',
        wireModelId: 'memeloop-embedding',
        apiMode: 'chat-completions',
      },
    ],
    catalogProvider: {
      id: 'memeloop',
      name: 'MemeLoop',
      api: 'https://api.memeloop.dev',
      env: [],
      models: [
        {
          id: 'memeloop-default',
          name: 'Memeloop Default',
          attachment: false,
          reasoning: true,
          toolCall: true,
        },
        {
          id: 'memeloop-embedding',
          name: 'Memeloop Embedding',
          attachment: false,
          reasoning: false,
          toolCall: false,
        },
      ],
    },
  },
  {
    providerId: 'comfyui',
    providerType: 'comfyui',
    baseUrl: 'http://localhost:8188',
    enabled: false,
    models: [
      {
        modelId: 'flux',
        wireModelId: 'flux',
        apiMode: 'chat-completions',
      },
    ],
    catalogProvider: {
      id: 'comfyui',
      name: 'ComfyUI',
      api: 'http://localhost:8188',
      env: [],
      models: [
        {
          id: 'flux',
          name: 'Flux',
          attachment: false,
          reasoning: false,
          toolCall: false,
          modalities: { input: ['text'], output: ['image'] },
        },
      ],
    },
  },
];

const KNOWN_PROVIDER_TYPES = new Set([
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'groq',
  'mistral',
  'cohere',
  'xai',
  'togetherai',
  'perplexity',
  'azure',
  'google-vertex',
  'ollama',
]);

function routeForCatalogModel(model: ModelCatalogProvider['models'][number]): ProviderModelRoute {
  const maxOutputTokens = model.limit?.output;
  return {
    modelId: model.id,
    wireModelId: model.id,
    apiMode: 'chat-completions',
    ...(typeof maxOutputTokens === 'number' && maxOutputTokens > 0
      ? { requestDefaults: { maxOutputTokens } }
      : {}),
  };
}

function providerTypeForCatalogProvider(provider: ModelCatalogProvider): string {
  return KNOWN_PROVIDER_TYPES.has(provider.id) ? provider.id : provider.id;
}

/**
 * Project one exact Core catalog provider into the canonical account contract.
 * Catalog metadata is embedded unchanged; routes are the only executable
 * model declarations and therefore carry the logical/wire id pair explicitly.
 */
function accountForCatalogProvider(provider: ModelCatalogProvider): ProviderAccountConfig {
  return {
    providerId: provider.id,
    providerType: providerTypeForCatalogProvider(provider),
    ...(provider.api ? { baseUrl: provider.api } : {}),
    enabled: false,
    models: provider.models.map(routeForCatalogModel),
    catalogProvider: provider,
  };
}

/** Return canonical accounts for the current Core catalog plus app-owned accounts. */
export function providerAccountsFromModelCatalog(
  catalog: ModelCatalog,
): readonly ProviderAccountConfig[] {
  const catalogAccounts = catalog.providers.map(accountForCatalogProvider);
  const catalogProviderIds = new Set(catalogAccounts.map(account => account.providerId));
  const appSpecificAccounts = APP_SPECIFIC_PROVIDER_ACCOUNTS.filter(
    account => !catalogProviderIds.has(account.providerId),
  );
  return Object.freeze(
    [...catalogAccounts, ...appSpecificAccounts]
      .sort((left, right) => left.providerId.localeCompare(right.providerId)),
  );
}

export function embeddedOfficialProviderAccounts(): readonly ProviderAccountConfig[] {
  return providerAccountsFromModelCatalog(EMBEDDED_MODEL_CATALOG);
}
