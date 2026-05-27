// Stub: Syncable config types and constants - kept for compilation compatibility

export type SyncableConfigField = string;

export interface ISyncableWikiConfig {
  id?: string;
  [key: string]: unknown;
}

export interface IWikiWorkspaceMinimal {
  id: string;
  name?: string;
  wikiFolderLocation?: string;
  [key: string]: unknown;
}

export const syncableConfigFields: SyncableConfigField[] = [];

export const syncableConfigDefaultValues: Record<string, unknown> = {};
