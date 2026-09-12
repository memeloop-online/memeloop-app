/** Runtime IPC surface exposed by MemeLoop App. */
import { createProxy } from 'electron-ipc-cat/client';
import type { AsyncifyProxy } from 'electron-ipc-cat/common';

import { AgentBrowserServiceIPCDescriptor, type IAgentBrowserService } from '@services/agentBrowser/interface';
import { AgentDefinitionServiceIPCDescriptor, type IAgentDefinitionService } from '@services/agentDefinition/interface';
import { AgentInstanceServiceIPCDescriptor, type IAgentInstanceService } from '@services/agentInstance/interface';
import { ContextServiceIPCDescriptor, type IContextService } from '@services/context/interface';
import { DatabaseServiceIPCDescriptor, type IDatabaseService } from '@services/database/interface';
import { DeepLinkServiceIPCDescriptor, type IDeepLinkService } from '@services/deepLink/interface';
import { DeviceNetworkServiceIPCDescriptor, type IDeviceNetworkService } from '@services/deviceNetwork/interface';
import { type INativeService, NativeServiceIPCDescriptor } from '@services/native/interface';
import { type INotificationService, NotificationServiceIPCDescriptor } from '@services/notifications/interface';
import { type IPreferenceService, PreferenceServiceIPCDescriptor } from '@services/preferences/interface';
import { type IProviderRegistryService, ProviderRegistryServiceIPCDescriptor } from '@services/providerRegistry/interface';
import { type IRemoteSetupService, RemoteSetupServiceIPCDescriptor } from '@services/sshRemote/interface';
import { type ISystemPreferenceService, SystemPreferenceServiceIPCDescriptor } from '@services/systemPreferences/interface';
import { type IThemeService, ThemeServiceIPCDescriptor } from '@services/theme/interface';
import { type IToolPermissionsService, ToolPermissionsServiceIPCDescriptor } from '@services/toolPermissions/interface';
import { type IUpdaterService, UpdaterServiceIPCDescriptor } from '@services/updater/interface';
import { type IWindowService, WindowServiceIPCDescriptor } from '@services/windows/interface';

export const agentBrowser = createProxy<AsyncifyProxy<IAgentBrowserService>>(AgentBrowserServiceIPCDescriptor);
export const agentDefinition = createProxy<AsyncifyProxy<IAgentDefinitionService>>(AgentDefinitionServiceIPCDescriptor);
export const agentInstance = createProxy<AsyncifyProxy<IAgentInstanceService>>(AgentInstanceServiceIPCDescriptor);
export const context = createProxy<IContextService>(ContextServiceIPCDescriptor);
export const database = createProxy<IDatabaseService>(DatabaseServiceIPCDescriptor);
export const deepLink = createProxy<IDeepLinkService>(DeepLinkServiceIPCDescriptor);
export const deviceNetwork = createProxy<AsyncifyProxy<IDeviceNetworkService>>(DeviceNetworkServiceIPCDescriptor);
export const externalAPI = createProxy<IProviderRegistryService>(ProviderRegistryServiceIPCDescriptor);
export const native = createProxy<INativeService>(NativeServiceIPCDescriptor);
export const notification = createProxy<INotificationService>(NotificationServiceIPCDescriptor);
export const preference = createProxy<IPreferenceService>(PreferenceServiceIPCDescriptor);
export const sshRemote = createProxy<IRemoteSetupService>(RemoteSetupServiceIPCDescriptor);
export const systemPreference = createProxy<ISystemPreferenceService>(SystemPreferenceServiceIPCDescriptor);
export const theme = createProxy<IThemeService>(ThemeServiceIPCDescriptor);
export const toolPermissions = createProxy<AsyncifyProxy<IToolPermissionsService>>(ToolPermissionsServiceIPCDescriptor);
export const updater = createProxy<IUpdaterService>(UpdaterServiceIPCDescriptor);
export const window = createProxy<IWindowService>(WindowServiceIPCDescriptor);

export const descriptors = {
  agentBrowser: AgentBrowserServiceIPCDescriptor,
  agentDefinition: AgentDefinitionServiceIPCDescriptor,
  agentInstance: AgentInstanceServiceIPCDescriptor,
  context: ContextServiceIPCDescriptor,
  database: DatabaseServiceIPCDescriptor,
  deepLink: DeepLinkServiceIPCDescriptor,
  deviceNetwork: DeviceNetworkServiceIPCDescriptor,
  externalAPI: ProviderRegistryServiceIPCDescriptor,
  native: NativeServiceIPCDescriptor,
  notification: NotificationServiceIPCDescriptor,
  preference: PreferenceServiceIPCDescriptor,
  sshRemote: RemoteSetupServiceIPCDescriptor,
  systemPreference: SystemPreferenceServiceIPCDescriptor,
  theme: ThemeServiceIPCDescriptor,
  toolPermissions: ToolPermissionsServiceIPCDescriptor,
  updater: UpdaterServiceIPCDescriptor,
  window: WindowServiceIPCDescriptor,
};
