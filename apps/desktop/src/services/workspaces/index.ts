// Stub: Workspaces service implementation - returns empty results
import { injectable } from 'inversify';
import { IWorkspace, IWorkspaceService, IWorkspaceWithMetadata } from './interface';

@injectable()
export class Workspace implements IWorkspaceService {
  async get(_id: string): Promise<IWorkspace | undefined> {
    return undefined;
  }

  async getWorkspacesAsList(): Promise<IWorkspaceWithMetadata[]> {
    return [];
  }

  async exists(_id: string): Promise<boolean> {
    return false;
  }

  async countWorkspaces(): Promise<number> {
    return 0;
  }

  async openWorkspaceTiddler(_workspaceId: string, _tiddlerTitle: string): Promise<void> {
    // no-op
  }

  async getSubWorkspacesAsList(_mainWorkspaceID: string): Promise<IWorkspaceWithMetadata[]> {
    return [];
  }

  getMainWorkspace(_subWorkspace: IWorkspace): IWorkspace | undefined {
    return undefined;
  }

  async getSyncableConfig(_workspace: IWorkspace): Promise<Record<string, unknown>> {
    return {};
  }
}
