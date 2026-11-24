import { type ILLMProvider, type ProviderModelRoute, type ProviderRegistration, ProviderRegistry } from 'memeloop';
import type { DesktopModelConfiguration } from './conversationModelParameters';

/** Main owns credentials; worker owns exact public routes used by preparation and preview. */
export class DesktopWorkerModelRegistry {
  readonly registry = new ProviderRegistry();
  private readonly registrations = new Map<string, { digest: string; registration: ProviderRegistration }>();

  constructor(private readonly bridge: ILLMProvider) {}

  update(configuration: DesktopModelConfiguration): void {
    const routes = new Map<string, ProviderModelRoute[]>();
    for (const route of configuration.routes) {
      const models = routes.get(route.providerId) ?? [];
      models.push({
        modelId: route.modelId,
        wireModelId: route.wireModelId,
        apiMode: route.apiMode,
        requestDefaults: route.parameters,
      });
      routes.set(route.providerId, models);
    }
    for (const [providerId, current] of this.registrations) {
      if (!routes.has(providerId)) {
        current.registration.dispose();
        this.registrations.delete(providerId);
      }
    }
    for (const [providerId, models] of routes) {
      const digest = JSON.stringify(models);
      const previous = this.registrations.get(providerId);
      if (previous?.digest === digest) continue;
      previous?.registration.dispose();
      const registration = this.registry.register(
        { ownerId: 'desktop/main-model-routes', kind: 'host' },
        { ...this.bridge, name: providerId },
        { models },
      );
      this.registrations.set(providerId, { digest, registration });
    }
  }
}
