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
  getTiddlers = 'get-tiddlers',
  insertTiddlers = 'insert-tiddlers',
  name = 'DatabaseChannel',
  searchTiddlers = 'search-tiddlers',
}
export enum GitChannel {
  name = 'GitChannel',
}
export enum GitServerChannel {
  name = 'GitServerChannel',
}
export enum MenuChannel {
  name = 'MenuChannel',
}
export enum NativeChannel {
  name = 'NativeChannel',
  showElectronMessageBoxSync = 'show-electron-message-box-sync',
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
  // TODO: add back the listener as https://github.com/webcatalog/neutron/blob/52a35f103761d82ae5a35e5f90fc39024830bc63/src/listeners/index.js#L80
  updateCanGoBack = 'update-can-go-back',
  updateCanGoForward = 'update-can-go-forward',
}

/**
 * Data payload for askAIWithSelection channel
 */
export interface IAskAIWithSelectionData {
  /** Agent definition ID to use, or undefined for default agent */
  agentDefId?: string;
  /** The selected text that user wants to ask AI about */
  selectionText: string;
  /** Wiki URL associated with the selection. */
  wikiUrl?: string;
  /** Workspace associated with the selection. */
  workspaceId?: string;
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

export enum SyncChannel {
  name = 'SyncChannel',
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

export enum HtmlWikiChannel {
  name = 'HtmlWikiChannel',
}

export enum DeviceNetworkChannel {
  name = 'DeviceNetworkChannel',
}

export enum MemeloopNodeChannel {
  name = 'MemeloopNodeChannel',
}

export enum ToolPermissionsChannel {
  name = 'ToolPermissionsChannel',
}

export enum RemoteTerminalChannel {
  name = 'RemoteTerminalChannel',
}

// Deprecated: Wiki-related channels kept for backward compatibility with agent tools
export enum WikiChannel {
  addTiddler = 'wiki-add-tiddler',
  createProgress = 'wiki-create-progress',
  deleteTiddler = 'wiki-delete-tiddler',
  dispatchEvent = 'wiki-send-action-message',
  generalNotification = 'wiki-notification-tiddly-git',
  getTiddler = 'wiki-get-tiddler',
  getTiddlerText = 'wiki-get-tiddler-text',
  getTiddlersAsJson = 'get-tiddlers-as-json',
  invokeActionsByTag = 'wiki-invoke-actions-by-tag',
  name = 'WikiChannel',
  openTiddler = 'wiki-open-tiddler',
  renderTiddlerOuterHTML = 'render-tiddler',
  renderWikiText = 'render-wiki-text',
  runFilter = 'wiki-run-filter',
  setState = 'wiki-set-state',
  setTiddlerText = 'wiki-set-tiddler-text',
  syncProgress = 'wiki-sync-progress',
}
export enum WikiGitWorkspaceChannel {
  name = 'WikiGitWorkspaceChannel',
}
export enum WorkspaceChannel {
  focusWorkspace = 'focus-workspace',
  name = 'WorkspaceChannel',
}
export enum WorkspaceViewChannel {
  name = 'WorkspaceViewChannel',
}
export enum WikiEmbeddingChannel {
  name = 'WikiEmbeddingChannel',
}

export type Channels =
  | MainChannel
  | AuthenticationChannel
  | ContextChannel
  | GitChannel
  | MenuChannel
  | NativeChannel
  | NotificationChannel
  | SystemPreferenceChannel
  | UpdaterChannel
  | ViewChannel
  | WikiChannel
  | WikiGitWorkspaceChannel
  | WorkspaceChannel
  | WorkspaceViewChannel
  | DatabaseChannel
  | PreferenceChannel
  | WindowChannel
  | ThemeChannel
  | I18NChannels
  | MetaDataChannel
  | SyncChannel
  | AgentChannel
  | WikiEmbeddingChannel
  | MemeloopNodeChannel
  | ToolPermissionsChannel
  | RemoteTerminalChannel;
