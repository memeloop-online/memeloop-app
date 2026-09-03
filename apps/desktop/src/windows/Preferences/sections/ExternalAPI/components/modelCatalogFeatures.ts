import type { ModelFeature } from '@services/providerRegistry/interface';
import type { ModelCatalogModel, ProviderAccountConfig, ProviderModelRoute } from 'memeloop';

/** Resolve catalog metadata for an executable Core model route. */
export function catalogModelForRoute(
  account: ProviderAccountConfig,
  route: ProviderModelRoute,
): ModelCatalogModel | undefined {
  return account.catalogProvider?.models.find(model => model.id === route.modelId);
}

/** Derive UI-only feature labels from Core catalog metadata. */
export function modelFeaturesForRoute(
  account: ProviderAccountConfig,
  route: ProviderModelRoute,
): readonly ModelFeature[] {
  const model = catalogModelForRoute(account, route);
  if (!model) return ['language'];

  const features: ModelFeature[] = [];
  const input = model.modalities?.input ?? [];
  const output = model.modalities?.output ?? [];
  if (output.includes('text') || model.reasoning || model.toolCall) features.push('language');
  if (model.attachment || input.includes('image')) features.push('vision');
  if (model.reasoning) features.push('reasoning');
  if (model.toolCall) features.push('toolCalling');
  if (output.includes('image')) features.push('imageGeneration');
  if (output.includes('audio')) features.push('speech');
  if (input.includes('audio')) features.push('transcriptions');
  if (output.includes('embedding')) features.push('embedding');
  if (features.length === 0) features.push('language');
  return features;
}

export function modelLabel(account: ProviderAccountConfig, route: ProviderModelRoute): string {
  return catalogModelForRoute(account, route)?.name ?? route.modelId;
}

export function modelOptionKey(account: ProviderAccountConfig, route: ProviderModelRoute): string {
  return `${account.providerId}:${route.modelId}`;
}
