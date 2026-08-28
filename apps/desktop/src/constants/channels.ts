/** Channels controls main thread */
export enum MainChannel {
  /**
   * Common initialization procedural of electron app booting finished, we can do more domain specific jobs
   */
  commonInitFinished = 'common-init-finished',
  windowAllClosed = 'window-all-closed',
}

export enum AuthenticationChannel {
  name = 'AuthenticationChannel',
  update = 'update',
}
export enum ContextChannel {
  name = 'ContextChannel',
}
export enum DatabaseChannel {
  name = 'DatabaseChannel',
}
export enum NativeChannel {
  name = 'NativeChannel',
}
export enum NotificationChannel {
  name = 'NotificationChannel',
}
export enum SystemPreferenceChannel {
  name = 'SystemPreferenceChannel',
  setSystemPreference = 'set-system-preference',
}
export enum UpdaterChannel {
  name = 'UpdaterChannel',
  updateUpdater = 'update-updater',
}
export enum ViewChannel {
  name = 'ViewChannel',
  onlineStatusChanged = 'online-status-changed',
  updateFindInPageMatches = 'update-find-in-page-matches',
}
export enum PreferenceChannel {
  getPreference = 'get-preference',
  getPreferences = 'get-preferences',
  name = 'PreferenceChannel',
  update = 'update',
}

export enum WindowChannel {
  /**
   * Navigate to Agent page and open a split view with WebView on left and Chat on right, sending the selected text as initial message.
   * Data payload: IAskAIWithSelectionData
   */
  askAIWithSelection = 'ask-ai-with-selection',
  closeFindInPage = 'close-find-in-page',
  name = 'WindowChannel',
  openFindInPage = 'open-find-in-page',
}

/**
 * Data payload for askAIWithSelection channel
 */
export interface IAskAIWithSelectionData {
  /** Agent definition ID to use, or undefined for default agent */
  agentDefId?: string;
  /** The selected text that user wants to ask AI about */
  selectionText: string;
}

export enum ThemeChannel {
  name = 'ThemeChannel',
}

export enum I18NChannels {
  changeLanguageRequest = 'ChangeLanguage-Request',
  name = 'I18NChannels',
  readFileRequest = 'ReadFile-Request',
  readFileResponse = 'ReadFile-Response',
  writeFileRequest = 'WriteFile-Request',
  writeFileResponse = 'WriteFile-Response',
}

export enum MetaDataChannel {
  browserViewMetaData = 'browserViewMetaData',
  getViewMetaData = 'getViewMetaData',
  name = 'MetaDataChannel',
  pushViewMetaData = 'pushViewMetaData',
}

export enum AgentChannel {
  definition = 'AgentDefinitionChannel',
  instance = 'AgentInstanceChannel',
  browser = 'AgentBrowserChannel',
}

export enum ExternalAPIChannel {
  name = 'ExternalAPIChannel',
}

export enum ProviderRegistryChannel {
  name = 'ProviderRegistryChannel',
}

export enum AnalyticsChannel {
  name = 'AnalyticsChannel',
}

export enum DeviceNetworkChannel {
  name = 'DeviceNetworkChannel',
}

export enum ToolPermissionsChannel {
  name = 'ToolPermissionsChannel',
}

export type Channels =
  | MainChannel
  | AuthenticationChannel
  | ContextChannel
  | NativeChannel
  | NotificationChannel
  | SystemPreferenceChannel
  | UpdaterChannel
  | ViewChannel
  | DatabaseChannel
  | PreferenceChannel
  | WindowChannel
  | ThemeChannel
  | I18NChannels
  | MetaDataChannel
  | AgentChannel
  | ToolPermissionsChannel;
