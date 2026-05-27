// Stub: WikiEmbedding service implementation stub
import { injectable } from 'inversify';
import { IWikiEmbeddingService, EmbeddingStatus, EmbeddingStats } from './interface';

@injectable()
export class WikiEmbeddingService implements IWikiEmbeddingService {
  async getEmbeddingStatus(_workspaceId: string): Promise<EmbeddingStatus> {
    return { status: 'idle' };
  }

  async getEmbeddingStats(_workspaceId: string): Promise<EmbeddingStats> {
    return { totalEmbeddings: 0, totalNotes: 0 };
  }

  async generateEmbeddings(_workspaceId: string, _aiConfig: unknown, _force?: boolean): Promise<void> {
    // no-op
  }

  async deleteWorkspaceEmbeddings(_workspaceId: string): Promise<void> {
    // no-op
  }
}

export { type IWikiEmbeddingService, type EmbeddingStatus, type EmbeddingStats };
