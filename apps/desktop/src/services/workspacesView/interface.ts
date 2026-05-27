import { ProxyPropertyType } from 'electron-ipc-cat/common';
import { WorkspaceViewChannel } from '@/constants/channels';

// Stub: Workspaces view service interface - implementation to be re-added in future refactoring
export interface IWorkspaceViewService {
  setActiveWorkspaceView(workspaceID: string): Promise<void>;
  realignActiveWorkspace(workspaceID?: string): Promise<void>;
  restartWorkspaceViewService(workspaceID: string): Promise<void>;
  wakeUpWorkspaceView(workspaceID: string): Promise<void>;
}

export const WorkspaceViewServiceIPCDescriptor = {
  channel: WorkspaceViewChannel.name,
  properties: {
    setActiveWorkspaceView: ProxyPropertyType.Function,
    realignActiveWorkspace: ProxyPropertyType.Function,
    restartWorkspaceViewService: ProxyPropertyType.Function,
    wakeUpWorkspaceView: ProxyPropertyType.Function,
  },
};
