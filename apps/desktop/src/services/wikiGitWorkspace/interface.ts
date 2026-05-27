// Stub: WikiGitWorkspace service interface - implementation to be re-added in future refactoring
import { ProxyPropertyType } from 'electron-ipc-cat/common';
import { WikiGitWorkspaceChannel } from '@/constants/channels';

export interface IWikiGitWorkspaceService {
  // no-op stub
}

export const WikiGitWorkspaceServiceIPCDescriptor = {
  channel: WikiGitWorkspaceChannel.name,
  properties: {},
};
