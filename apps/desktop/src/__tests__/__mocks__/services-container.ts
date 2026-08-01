import type { IMemeloopNodeService } from '@/services/memeloopNode/interface';
import type { AIStreamResponse } from '@/services/providerRegistry/interface';
import type { IToolApprovalRequest, IToolPermissionsService } from '@/services/toolPermissions/interface';
import { AgentBrowserService } from '@services/agentBrowser';
import { AgentDefinitionService } from '@services/agentDefinition';
import { AgentInstanceService } from '@services/agentInstance';
import { container } from '@services/container';
import type { IContextService } from '@services/context/interface';
import { DatabaseService } from '@services/database';
import type { INativeService } from '@services/native/interface';
import type { IPreferenceService } from '@services/preferences/interface';
import { ProviderRegistryService } from '@services/providerRegistry';
import type { IProviderRegistryService } from '@services/providerRegistry/interface';
import serviceIdentifier from '@services/serviceIdentifier';
import type { IWindowService } from '@services/windows/interface';
import { BehaviorSubject, Observable } from 'rxjs';
import { vi } from 'vitest';

// Mock bindServiceAndProxy to be an empty function
// This allows us to control service bindings in tests instead of using production bindings (while currently it is not called because it is called in `main.ts` and it is not executed during test.)
vi.mock('@services/libs/bindServiceAndProxy', () => ({
  bindServiceAndProxy: vi.fn(),
}));

export const serviceInstances: {
  window: Partial<IWindowService>;
  native: Partial<INativeService>;
  auth: Record<string, unknown>;
  context: Partial<IContextService>;
  preference: Partial<IPreferenceService>;
  externalAPI: Partial<IProviderRegistryService>;
  toolPermissions: Partial<IToolPermissionsService>;
  memeloopNode: Partial<IMemeloopNodeService>;
} = {
  window: {
    open: vi.fn().mockResolvedValue(undefined),
  },
  native: {
    log: vi.fn().mockResolvedValue(undefined),
    pickDirectory: vi.fn().mockResolvedValue(['/test/selected/path']),
  },
  auth: {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    getStorageServiceUserInfo: vi.fn().mockResolvedValue(undefined),
    getUserInfos: vi.fn().mockResolvedValue({ userName: '' }),
    setUserInfos: vi.fn(),
  },
  context: {
    get: vi.fn().mockResolvedValue(undefined),
  },
  preference: (() => {
    const store: Record<string, unknown> = {};
    return {
      get: vi.fn(async (key: string) => store[key]),
      set: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
      }),
      resetWithConfirm: vi.fn(async () => undefined),
    } as Partial<IPreferenceService>;
  })(),
  externalAPI: {
    getAIConfig: vi.fn(async () => ({ default: { model: 'test-model', provider: 'test-provider' }, modelParameters: {} })),
    getAIProviders: vi.fn(async () => []),
    generateFromAI: vi.fn(async function*() {
      // harmless await for linter
      await Promise.resolve();
      yield { requestId: 'r0', content: '', status: 'start' } as AIStreamResponse;
      return;
    }),
    streamFromAI: vi.fn((_messages, _config) =>
      new Observable<AIStreamResponse>((subscriber) => {
        subscriber.next({ requestId: 'r1', content: 'ok', status: 'start' });
        subscriber.next({ requestId: 'r1', content: 'ok', status: 'done' });
        subscriber.complete();
      })
    ),
    generateEmbeddings: vi.fn(async () => ({
      requestId: 'test-request',
      embeddings: [[0.1, 0.2, 0.3, 0.4]], // Default 4D embedding
      model: 'test-embedding-model',
      object: 'embedding',
      usage: {
        prompt_tokens: 10,
        total_tokens: 10,
      },
      status: 'done' as const,
    })),
    cancelAIRequest: vi.fn(async () => undefined),
    updateProvider: vi.fn(async () => undefined),
    deleteProvider: vi.fn(async () => undefined),
    updateDefaultAIConfig: vi.fn(async () => undefined),
    deleteFieldFromDefaultAIConfig: vi.fn(async () => undefined),
  },
  toolPermissions: {
    getPermissions: vi.fn(async () => []),
    addPermission: vi.fn(async () => undefined),
    removePermission: vi.fn(async () => undefined),
    clearList: vi.fn(async () => undefined),
    checkPermission: vi.fn(async () => true),
    requestApproval: vi.fn(async () => 'allow-once' as const),
    resolveApproval: vi.fn(async () => undefined),
    pendingApprovals$: new BehaviorSubject<IToolApprovalRequest[]>([]),
    getSessionApprovals: vi.fn(async () => []),
    clearSessionApprovals: vi.fn(async () => undefined),
  } as Partial<IToolPermissionsService>,
  memeloopNode: {
    cloudLogin: vi.fn(async () => ({ ok: true })),
    cloudLogout: vi.fn(async () => undefined),
    setCloudUrl: vi.fn(async () => undefined),
    getCloudUrl: vi.fn(async () => null),
    getAccountStatus: vi.fn(async () => ({
      cloudUrl: null,
      loggedIn: false,
      email: null,
    })),
    getSubscriptionStatus: vi.fn(async () => ({
      plan: 'free' as const,
      status: 'active' as const,
      tokenUsed: 0,
      tokenTotal: 10000,
      billingHistory: [],
    })),
    openBillingPage: vi.fn(async () => undefined),
  } as Partial<IMemeloopNodeService>,
};

// Bind the shared mocks into container so real services resolved from container.get()
// will receive these mocks during tests.
container.bind(serviceIdentifier.Window).toConstantValue(serviceInstances.window);
container.bind(serviceIdentifier.NativeService).toConstantValue(serviceInstances.native);
container.bind(serviceIdentifier.ProviderRegistry).to(ProviderRegistryService).inSingletonScope();
container.bind(serviceIdentifier.Preference).toConstantValue(serviceInstances.preference);
container.bind(serviceIdentifier.Context).toConstantValue(serviceInstances.context);
container.bind(serviceIdentifier.Authentication).toConstantValue(serviceInstances.auth);
container.bind(serviceIdentifier.AgentDefinition).to(AgentDefinitionService).inSingletonScope();
container.bind(serviceIdentifier.AgentBrowser).to(AgentBrowserService).inSingletonScope();
// Bind real DatabaseService instead of mock
container.bind(serviceIdentifier.Database).to(DatabaseService).inSingletonScope();
container.bind(serviceIdentifier.AgentInstance).to(AgentInstanceService).inSingletonScope();

container.get<AgentInstanceService>(serviceIdentifier.AgentInstance)
  .configureMemeLoopHostIdentity({
    peerId: '12D3KooWTestDesktopIdentity',
    publicKeyMultibase: 'zTestPublicKey',
    privateKeyRef: 'test-only',
    createdAt: 0,
    deviceName: 'Test Desktop',
    platform: 'desktop',
  });
