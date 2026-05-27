import { ProxyPropertyType } from 'electron-ipc-cat/common';

// Stub: Wiki channel constants (previously in @/constants/channels)
export enum WikiChannel {
  name = 'WikiChannel',
  getTiddlerText = 'wiki-get-tiddler-text',
  addTiddler = 'wiki-add-tiddler',
  runFilter = 'wiki-run-filter',
  createProgress = 'wiki-create-progress',
  syncProgress = 'wiki-sync-progress',
  generalNotification = 'wiki-general-notification',
  invokeActionsByTag = 'wiki-invoke-actions-by-tag',
}

// Stub: Wiki service interface - implementation to be re-added in future refactoring
export interface IWikiService {
  wikiOperationInServer(channel: string, workspaceID: string, args?: unknown[]): Promise<unknown>;
  wikiOperationInBrowser(channel: string, workspaceID: string, args?: unknown[]): Promise<unknown>;
  callWikiIpcServerRoute(workspaceID: string, route: string, options?: unknown): Promise<IWikiRouteResponse>;
  getWorkersInfo(): Promise<IWorkerInfo[]>;
}

export interface IWikiRouteResponse {
  statusCode: number;
  data: unknown;
}

export interface IWorkerInfo {
  workspaceID: string;
  workspaceName: string;
  isRunning: boolean;
  threadId: number;
  port: number;
  rss_MB: number;
  heapUsed_MB: number;
  heapTotal_MB: number;
}

export enum ZxWorkerControlActions {
  run = 'run',
  stop = 'stop',
}

export const WikiServiceIPCDescriptor = {
  channel: WikiChannel.name,
  properties: {
    wikiOperationInServer: ProxyPropertyType.Function,
    wikiOperationInBrowser: ProxyPropertyType.Function,
    callWikiIpcServerRoute: ProxyPropertyType.Function,
    getWorkersInfo: ProxyPropertyType.Function,
  },
};
