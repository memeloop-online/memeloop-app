// Stub: Wiki service implementation stub
import { injectable } from 'inversify';
import { IWikiService, IWikiRouteResponse, IWorkerInfo } from './interface';

@injectable()
export class Wiki implements IWikiService {
  async wikiOperationInServer(_channel: string, _workspaceID: string, _args?: unknown[]): Promise<unknown> {
    return [];
  }

  async wikiOperationInBrowser(_channel: string, _workspaceID: string, _args?: unknown[]): Promise<unknown> {
    return null;
  }

  async callWikiIpcServerRoute(_workspaceID: string, _route: string, _options?: unknown): Promise<IWikiRouteResponse> {
    return { statusCode: 404, data: null };
  }

  async getWorkersInfo(): Promise<IWorkerInfo[]> {
    return [];
  }
}

// Re-export types
export { type IWikiService } from './interface';
export { WikiChannel } from './interface';
