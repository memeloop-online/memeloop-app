import { WikiEmbeddingChannel } from '@/constants/channels';
import { ProxyPropertyType } from 'electron-ipc-cat/common';

export { type EmbeddingStats, type EmbeddingStatus, type IWikiEmbeddingService } from './interface';

export const WikiEmbeddingServiceIPCDescriptor = {
  channel: WikiEmbeddingChannel.name,
  properties: {
    getEmbeddingStatus: ProxyPropertyType.Function,
    getEmbeddingStats: ProxyPropertyType.Function,
    generateEmbeddings: ProxyPropertyType.Function,
    deleteWorkspaceEmbeddings: ProxyPropertyType.Function,
  },
};
