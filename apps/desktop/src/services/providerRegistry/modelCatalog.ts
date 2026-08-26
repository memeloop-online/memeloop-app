import { EMBEDDED_MODEL_CATALOG, type ModelCatalog, type ModelCatalogModel, type ModelCatalogProvider } from 'memeloop/model-catalog';

import defaultProvidersConfig from './defaultProviders';
import type { AIProviderConfig, ModelFeature, ModelInfo } from './interface';

const providerClassOverrides: Readonly<Record<string, string>> = {
  anthropic: 'anthropic',
  deepseek: 'deepseek',
  ollama: 'ollama',
  openai: 'openai',
};

function catalogFeatures(model: ModelCatalogModel): ModelFeature[] {
  const features = new Set<ModelFeature>(['language']);
  if (model.reasoning) features.add('reasoning');
  if (model.toolCall) features.add('toolCalling');
  if (
    model.attachment ||
    model.modalities?.input.some(modality => modality === 'image')
  ) {
    features.add('vision');
  }
  if (model.modalities?.output.some(modality => modality === 'image')) {
    features.add('imageGeneration');
  }
  return [...features];
}

function toModelInfo(model: ModelCatalogModel): ModelInfo {
  return {
    name: model.id,
    caption: model.name,
    features: catalogFeatures(model),
    contextWindowSize: model.limit?.context ?? model.limit?.input,
    maxOutputTokens: model.limit?.output,
    metadata: {
      source: 'models.dev',
      attachment: model.attachment,
      structuredOutput: model.structuredOutput,
      temperature: model.temperature,
      releaseDate: model.releaseDate,
      lastUpdated: model.lastUpdated,
      status: model.status,
      modalities: model.modalities,
    },
  };
}

function toProviderConfig(provider: ModelCatalogProvider): AIProviderConfig {
  const legacyPreset = defaultProvidersConfig.providers.find(
    candidate => candidate.provider === provider.id,
  ) as AIProviderConfig | undefined;
  const providerClass = legacyPreset?.providerClass ??
    providerClassOverrides[provider.id] ??
    'openAICompatible';
  return {
    ...legacyPreset,
    provider: provider.id,
    providerClass,
    baseURL: legacyPreset?.baseURL ?? provider.api,
    enabled: legacyPreset?.enabled ?? false,
    isPreset: true,
    showBaseURLField: legacyPreset?.showBaseURLField ??
      providerClass === 'openAICompatible',
    models: provider.models.map(toModelInfo),
  };
}

/**
 * Convert the portable Core catalog to the host's existing provider editor
 * contract. App-specific providers are retained, while catalog-backed models
 * always come from the current Core snapshot instead of a copied list.
 */
export function providerConfigsFromModelCatalog(
  catalog: ModelCatalog,
): AIProviderConfig[] {
  const fromCatalog = catalog.providers.map(toProviderConfig);
  const catalogProviderIds = new Set(fromCatalog.map(provider => provider.provider));
  const appSpecific = (defaultProvidersConfig.providers as AIProviderConfig[])
    .filter(provider => !catalogProviderIds.has(provider.provider));
  return [...fromCatalog, ...appSpecific].sort((left, right) => left.provider.localeCompare(right.provider));
}

export function embeddedOfficialProviderConfigs(): AIProviderConfig[] {
  return providerConfigsFromModelCatalog(EMBEDDED_MODEL_CATALOG);
}
