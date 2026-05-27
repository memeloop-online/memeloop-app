// Stub: Wiki embedding service interface - implementation to be re-added in future refactoring
export interface IWikiEmbeddingService {
  getEmbeddingStatus(workspaceId: string): Promise<EmbeddingStatus>;
  getEmbeddingStats(workspaceId: string): Promise<EmbeddingStats>;
  generateEmbeddings(workspaceId: string, aiConfig: unknown, force?: boolean): Promise<void>;
  deleteWorkspaceEmbeddings(workspaceId: string): Promise<void>;
}

export interface EmbeddingStatus {
  status: 'idle' | 'generating' | 'completed' | 'error';
  progress?: { total: number; completed: number; current?: string };
  error?: string;
  lastUpdated?: Date;
}

export interface EmbeddingStats {
  totalEmbeddings: number;
  totalNotes: number;
}

export interface EmbeddingRecord {
  id: number;
  workspaceId: string;
  tiddlerTitle: string;
  chunkIndex?: number;
  totalChunks?: number;
  created: Date;
  modified: Date;
  model: string;
  provider: string;
  dimensions: number;
}

import { ProxyPropertyType } from 'electron-ipc-cat/common';
import { WikiEmbeddingChannel } from '@/constants/channels';

export const WikiEmbeddingServiceIPCDescriptor = {
  channel: WikiEmbeddingChannel.name,
  properties: {
    getEmbeddingStatus: ProxyPropertyType.Function,
    getEmbeddingStats: ProxyPropertyType.Function,
    generateEmbeddings: ProxyPropertyType.Function,
    deleteWorkspaceEmbeddings: ProxyPropertyType.Function,
  },
};
