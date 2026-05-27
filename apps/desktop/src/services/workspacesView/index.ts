// Stub: WorkspaceView service implementation stub
import { injectable } from 'inversify';
import { IWorkspaceViewService } from './interface';

@injectable()
export class WorkspaceView implements IWorkspaceViewService {
  async setActiveWorkspaceView(_workspaceID: string): Promise<void> {
    // no-op
  }

  async realignActiveWorkspace(_workspaceID?: string): Promise<void> {
    // no-op
  }

  async restartWorkspaceViewService(_workspaceID: string): Promise<void> {
    // no-op
  }

  async wakeUpWorkspaceView(_workspaceID: string): Promise<void> {
    // no-op
  }
}

export { type IWorkspaceViewService } from './interface';
