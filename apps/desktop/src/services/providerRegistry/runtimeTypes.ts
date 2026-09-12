import type { ModelCatalogModel, ProviderAccountConfig } from 'memeloop';

/**
 * Runtime-only provider account view.  The canonical account never contains
 * plaintext credentials; the resolver attaches an API key only for the
 * duration of an outbound request.
 */
export interface ProviderRuntimeConfig {
  readonly account: Readonly<ProviderAccountConfig>;
  readonly apiKey?: string;
}

export function catalogModelForRoute(
  account: Readonly<ProviderAccountConfig>,
  modelId: string,
): ModelCatalogModel | undefined {
  return account.catalogProvider?.models.find(model => model.id === modelId);
}

export function modelSupportsVision(
  account: Readonly<ProviderAccountConfig>,
  modelId: string,
): boolean {
  const model = catalogModelForRoute(account, modelId);
  return Boolean(model?.attachment || model?.modalities?.input.includes('image'));
}
