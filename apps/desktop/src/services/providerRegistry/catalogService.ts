import type { ProviderAccountConfig } from 'memeloop';
import { EMBEDDED_MODEL_CATALOG, fetchModelCatalog, type ModelCatalog } from 'memeloop/model-catalog';

import { logger } from '@services/libs/log';
import { providerAccountsFromModelCatalog } from './modelCatalog';

/** Owns Core's official model catalog and provider display metadata. */
export class CatalogService {
  private officialModelCatalog: ModelCatalog = EMBEDDED_MODEL_CATALOG;
  private modelCatalogRefreshPromise?: Promise<ModelCatalog>;
  private modelCatalogRefreshedAt = 0;

  async getOfficialProviderAccounts(refresh = false): Promise<readonly ProviderAccountConfig[]> {
    if (refresh) {
      await this.refresh().catch((error: unknown) => {
        logger.warn('Official model catalog refresh failed; using cached Core catalog', { error });
      });
    }
    return providerAccountsFromModelCatalog(this.officialModelCatalog);
  }

  refresh(): Promise<ModelCatalog> {
    if (Date.now() - this.modelCatalogRefreshedAt < 6 * 60 * 60 * 1000) {
      return Promise.resolve(this.officialModelCatalog);
    }
    if (this.modelCatalogRefreshPromise) return this.modelCatalogRefreshPromise;
    const refresh = fetchModelCatalog({ timeoutMs: 15_000 })
      .then(catalog => {
        this.officialModelCatalog = catalog;
        this.modelCatalogRefreshedAt = Date.now();
        return catalog;
      })
      .finally(() => {
        if (this.modelCatalogRefreshPromise === refresh) {
          this.modelCatalogRefreshPromise = undefined;
        }
      });
    this.modelCatalogRefreshPromise = refresh;
    return refresh;
  }
}
