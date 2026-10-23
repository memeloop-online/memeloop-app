/**
 * MemeLoop App main-process composition root.
 *
 * Keep this list intentionally explicit: TiddlyWiki, workspace, Git,
 * BrowserView and TidGi mini-window services are host-adapter concerns and
 * must not become reachable just because App was forked from TidGi.
 */
import { registerProxy } from 'electron-ipc-cat/server';

import { AgentBrowserService } from '@services/agentBrowser';
import { AgentBrowserServiceIPCDescriptor, type IAgentBrowserService } from '@services/agentBrowser/interface';
import { AgentDefinitionService } from '@services/agentDefinition';
import { AgentDefinitionServiceIPCDescriptor, type IAgentDefinitionService } from '@services/agentDefinition/interface';
import { AgentInstanceService } from '@services/agentInstance';
import { AgentInstanceServiceIPCDescriptor, type IAgentInstanceService } from '@services/agentInstance/interface';
import { AnalyticsService } from '@services/analytics';
import { AnalyticsServiceIPCDescriptor, type IAnalyticsService } from '@services/analytics/interface';
import { container } from '@services/container';
import { ContextService } from '@services/context';
import { ContextServiceIPCDescriptor, type IContextService } from '@services/context/interface';
import { DatabaseService } from '@services/database';
import { DatabaseServiceIPCDescriptor, type IDatabaseService } from '@services/database/interface';
import { DeepLinkService } from '@services/deepLink';
import { DeepLinkServiceIPCDescriptor, type IDeepLinkService } from '@services/deepLink/interface';
import { DeviceNetworkService } from '@services/deviceNetwork';
import { DeviceNetworkServiceIPCDescriptor, type IDeviceNetworkService } from '@services/deviceNetwork/interface';
import { NativeService } from '@services/native';
import { type INativeService, NativeServiceIPCDescriptor } from '@services/native/interface';
import { NotificationService } from '@services/notifications';
import { type INotificationService, NotificationServiceIPCDescriptor } from '@services/notifications/interface';
import { Preference } from '@services/preferences';
import { type IPreferenceService, PreferenceServiceIPCDescriptor } from '@services/preferences/interface';
import serviceIdentifier from '@services/serviceIdentifier';
import { SystemPreference } from '@services/systemPreferences';
import { type ISystemPreferenceService, SystemPreferenceServiceIPCDescriptor } from '@services/systemPreferences/interface';
import { ThemeService } from '@services/theme';
import { type IThemeService, ThemeServiceIPCDescriptor } from '@services/theme/interface';
import { ToolPermissions } from '@services/toolPermissions';
import { type IToolPermissionsService, ToolPermissionsServiceIPCDescriptor } from '@services/toolPermissions/interface';
import { Updater } from '@services/updater';
import { type IUpdaterService, UpdaterServiceIPCDescriptor } from '@services/updater/interface';
import { AppWindow } from '@services/windows/appWindow';
import { type IWindowService, WindowServiceIPCDescriptor } from '@services/windows/interface';
import { ProviderRegistryService } from '../providerRegistry';
import { type IProviderRegistryService, ProviderRegistryServiceIPCDescriptor } from '../providerRegistry/interface';
import { type IRemoteSetupService, RemoteSetupServiceIPCDescriptor } from '../sshRemote/interface';
import { RemoteSetupService } from '../sshRemote/service';

type Binding<T> = {
  id: symbol;
  implementation: new(...arguments_: never[]) => T;
  descriptor: Parameters<typeof registerProxy>[1];
};

const bindings: Array<Binding<unknown>> = [
  { id: serviceIdentifier.AgentBrowser, implementation: AgentBrowserService, descriptor: AgentBrowserServiceIPCDescriptor },
  { id: serviceIdentifier.AgentDefinition, implementation: AgentDefinitionService, descriptor: AgentDefinitionServiceIPCDescriptor },
  { id: serviceIdentifier.AgentInstance, implementation: AgentInstanceService, descriptor: AgentInstanceServiceIPCDescriptor },
  { id: serviceIdentifier.Analytics, implementation: AnalyticsService, descriptor: AnalyticsServiceIPCDescriptor },
  { id: serviceIdentifier.Context, implementation: ContextService, descriptor: ContextServiceIPCDescriptor },
  { id: serviceIdentifier.Database, implementation: DatabaseService, descriptor: DatabaseServiceIPCDescriptor },
  { id: serviceIdentifier.DeepLink, implementation: DeepLinkService, descriptor: DeepLinkServiceIPCDescriptor },
  { id: serviceIdentifier.DeviceNetwork, implementation: DeviceNetworkService, descriptor: DeviceNetworkServiceIPCDescriptor },
  { id: serviceIdentifier.ProviderRegistry, implementation: ProviderRegistryService, descriptor: ProviderRegistryServiceIPCDescriptor },
  { id: serviceIdentifier.NativeService, implementation: NativeService, descriptor: NativeServiceIPCDescriptor },
  { id: serviceIdentifier.NotificationService, implementation: NotificationService, descriptor: NotificationServiceIPCDescriptor },
  { id: serviceIdentifier.Preference, implementation: Preference, descriptor: PreferenceServiceIPCDescriptor },
  { id: serviceIdentifier.RemoteSetup, implementation: RemoteSetupService, descriptor: RemoteSetupServiceIPCDescriptor },
  { id: serviceIdentifier.SystemPreference, implementation: SystemPreference, descriptor: SystemPreferenceServiceIPCDescriptor },
  { id: serviceIdentifier.ThemeService, implementation: ThemeService, descriptor: ThemeServiceIPCDescriptor },
  { id: serviceIdentifier.ToolPermissions, implementation: ToolPermissions, descriptor: ToolPermissionsServiceIPCDescriptor },
  { id: serviceIdentifier.Updater, implementation: Updater, descriptor: UpdaterServiceIPCDescriptor },
  { id: serviceIdentifier.Window, implementation: AppWindow, descriptor: WindowServiceIPCDescriptor },
];

export function bindServiceAndProxy(): void {
  for (const binding of bindings) {
    container.bind(binding.id).to(binding.implementation).inSingletonScope();
  }
  for (const binding of bindings) {
    registerProxy(container.get(binding.id), binding.descriptor);
  }
}

// Compile-time checks keep accidental interface drift visible without adding
// another runtime registration surface.
type AppServices =
  | IAgentBrowserService
  | IAgentDefinitionService
  | IAgentInstanceService
  | IAnalyticsService
  | IContextService
  | IDatabaseService
  | IDeepLinkService
  | IDeviceNetworkService
  | IProviderRegistryService
  | INativeService
  | INotificationService
  | IPreferenceService
  | IRemoteSetupService
  | ISystemPreferenceService
  | IThemeService
  | IToolPermissionsService
  | IUpdaterService
  | IWindowService;
void (undefined as AppServices | undefined);
