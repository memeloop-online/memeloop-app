import { PageType } from '@/constants/pageTypes';
import { SupportedStorageServices } from '@services/types';
import { ProxyPropertyType } from 'electron-ipc-cat/common';
import { WorkspaceChannel } from '@/constants/channels';

// Stub: Workspace interface - minimal shape for compilation compatibility
export interface IWorkspace {
  id: string;
  name: string;
  wikiFolderLocation?: string;
  homeUrl?: string;
  port?: number;
  isSubWiki?: boolean;
  mainWikiToLink?: string | null;
  mainWikiID?: string;
  tagNames?: string[];
  lastUrl?: string | null;
  active?: boolean;
  hibernated?: boolean;
  order?: number;
  enableHTTPAPI?: boolean;
  gitUrl?: string | null;
  readOnlyMode?: boolean;
  storageService?: SupportedStorageServices;
  syncOnInterval?: boolean;
  syncOnStartup?: boolean;
  tokenAuth?: boolean;
  transparentBackground?: boolean;
  userName?: string;
  picturePath?: string | null;
  disableNotifications?: boolean;
  backupOnInterval?: boolean;
  disableAudio?: boolean;
  excludedPlugins?: string[];
  enableFileSystemWatch?: boolean;
  hibernateWhenUnused?: boolean;
  pageType?: PageType;
}

export type IWorkspaceWithMetadata = IWorkspace & Record<string, unknown>;

export interface IWikiWorkspace extends IWorkspace {
  wikiFolderLocation: string;
}

export function isWikiWorkspace(ws: IWorkspace): boolean {
  return 'wikiFolderLocation' in ws && ws.pageType !== PageType.agent && ws.pageType !== PageType.guide && ws.pageType !== PageType.help && ws.pageType !== PageType.add;
}

export interface IWorkspaceService {
  get(id: string): Promise<IWorkspace | undefined>;
  getWorkspacesAsList(): Promise<IWorkspaceWithMetadata[]>;
  exists(id: string): Promise<boolean>;
  countWorkspaces(): Promise<number>;
  openWorkspaceTiddler(workspaceId: string, tiddlerTitle: string): Promise<void>;
}

export const wikiWorkspaceDefaultValues = {
  disableNotifications: false,
  backupOnInterval: false,
  disableAudio: false,
  excludedPlugins: [] as string[],
  enableFileSystemWatch: false,
  hibernateWhenUnused: false,
};

export interface ISyncableWikiConfig {
  [key: string]: unknown;
}

export const WorkspaceServiceIPCDescriptor = {
  channel: WorkspaceChannel.name,
  properties: {
    get: ProxyPropertyType.Function,
    getWorkspacesAsList: ProxyPropertyType.Function,
    exists: ProxyPropertyType.Function,
    countWorkspaces: ProxyPropertyType.Function,
    openWorkspaceTiddler: ProxyPropertyType.Function,
  },
};
