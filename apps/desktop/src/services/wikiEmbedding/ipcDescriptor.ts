import { WikiEmbeddingChannel } from '@/constants/channels';
import { ProxyPropertyType } from 'electron-ipc-cat/common';

export { type IWikiEmbeddingService, type EmbeddingStatus, type EmbeddingStats } from './interface';

export const WikiEmbeddingServiceIPCDescriptor = {
  channel: WikiEmbeddingChannel.name,
  properties: {
    getEmbeddingStatus: ProxyPropertyType.Function,
    getEmbeddingStats: ProxyPropertyType.Function,
    generateEmbeddings: ProxyPropertyType.Function,
    deleteWorkspaceEmbeddings: ProxyPropertyType.Function,
  },
};
