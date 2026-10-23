import type { IAgentInstanceService } from '@services/agentInstance/interface';
import { container } from '@services/container';
import { logger } from '@services/libs/log';
import serviceIdentifier from '@services/serviceIdentifier';
import { Subscription } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

describe('AgentInstanceService worker cleanup', () => {
  it('cleans reverse worker conversation mapping when a single worker conversation is cleaned up', () => {
    const service = container.get<IAgentInstanceService>(serviceIdentifier.AgentInstance) as unknown as {
      workerConversationByAgentId: Map<string, string>;
      workerAgentIdByConversationId: Map<string, string>;
      workerConversationCleanupByAgentId: Map<string, () => void>;
      cleanupWorkerConversation: (agentId: string) => void;
    };

    const agentId = 'agent-cleanup-test';
    const conversationId = 'worker-conversation-cleanup-test';
    service.workerConversationByAgentId.set(agentId, conversationId);
    service.workerAgentIdByConversationId.set(conversationId, agentId);
    service.workerConversationCleanupByAgentId.set(agentId, () => undefined);

    service.cleanupWorkerConversation(agentId);

    expect(service.workerConversationCleanupByAgentId.has(agentId)).toBe(false);
    expect(service.workerAgentIdByConversationId.has(conversationId)).toBe(false);

    service.workerConversationByAgentId.delete(agentId);
  });

  it('clears reverse worker conversation mappings when disposing the worker', async () => {
    const service = container.get<IAgentInstanceService>(serviceIdentifier.AgentInstance) as unknown as {
      workerConversationByAgentId: Map<string, string>;
      workerAgentIdByConversationId: Map<string, string>;
      workerConversationCleanupByAgentId: Map<string, () => void>;
      workerConversationMutationSubscriptions: Set<Subscription>;
      memeLoopUtilityProcess?: { kill: () => boolean };
      memeLoopWorker?: unknown;
      disposeMemeLoopWorker: () => Promise<void>;
    };

    const agentId = 'agent-dispose-test';
    const conversationId = 'worker-conversation-dispose-test';
    service.workerConversationByAgentId.set(agentId, conversationId);
    service.workerAgentIdByConversationId.set(conversationId, agentId);
    service.workerConversationCleanupByAgentId.set(agentId, () => undefined);
    const mutationSubscription = new Subscription();
    const unsubscribe = vi.spyOn(mutationSubscription, 'unsubscribe');
    service.workerConversationMutationSubscriptions.add(mutationSubscription);
    const kill = vi.fn(() => true);
    service.memeLoopUtilityProcess = { kill };
    service.memeLoopWorker = {};

    await service.disposeMemeLoopWorker();

    expect(service.workerConversationByAgentId.size).toBe(0);
    expect(service.workerAgentIdByConversationId.size).toBe(0);
    expect(service.workerConversationCleanupByAgentId.size).toBe(0);
    expect(service.workerConversationMutationSubscriptions.size).toBe(0);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(service.memeLoopUtilityProcess).toBeUndefined();
    expect(service.memeLoopWorker).toBeUndefined();
  });

  it('detaches dead-process subscriptions while preserving durable conversation IDs for rebind', () => {
    const service = container.get<IAgentInstanceService>(serviceIdentifier.AgentInstance) as unknown as {
      workerConversationByAgentId: Map<string, string>;
      workerAgentIdByConversationId: Map<string, string>;
      workerConversationCleanupByAgentId: Map<string, () => void>;
      detachCrashedWorkerConversations: () => void;
    };
    const agentId = 'agent-crash-rebind-test';
    const conversationId = 'worker-conversation-crash-rebind-test';
    const cleanup = vi.fn();
    service.workerConversationByAgentId.set(agentId, conversationId);
    service.workerAgentIdByConversationId.set(conversationId, agentId);
    service.workerConversationCleanupByAgentId.set(agentId, cleanup);

    service.detachCrashedWorkerConversations();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(service.workerConversationCleanupByAgentId.has(agentId)).toBe(false);
    expect(service.workerAgentIdByConversationId.has(conversationId)).toBe(false);
    expect(service.workerConversationByAgentId.get(agentId)).toBe(conversationId);

    service.workerConversationByAgentId.delete(agentId);
  });

  it('continues crash cleanup and records a warning when unsubscribe throws', () => {
    const service = container.get<IAgentInstanceService>(serviceIdentifier.AgentInstance) as unknown as {
      workerConversationByAgentId: Map<string, string>;
      workerAgentIdByConversationId: Map<string, string>;
      workerConversationCleanupByAgentId: Map<string, () => void>;
      detachCrashedWorkerConversations: () => void;
    };
    vi.clearAllMocks();
    const agentId = 'agent-crash-cleanup-failure-test';
    const conversationId = 'worker-conversation-crash-cleanup-failure-test';
    service.workerConversationByAgentId.set(agentId, conversationId);
    service.workerAgentIdByConversationId.set(conversationId, agentId);
    service.workerConversationCleanupByAgentId.set(agentId, () => {
      throw new Error('unsubscribe failed');
    });

    expect(() => {
      service.detachCrashedWorkerConversations();
    }).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      'MemeLoop UtilityProcess conversation cleanup failed after exit',
    );
    expect(service.workerConversationCleanupByAgentId.size).toBe(0);
    expect(service.workerAgentIdByConversationId.size).toBe(0);
    expect(service.workerConversationByAgentId.get(agentId)).toBe(conversationId);

    service.workerConversationByAgentId.delete(agentId);
  });

  it('does not block ordinary conversation cleanup when unsubscribe throws', () => {
    const service = container.get<IAgentInstanceService>(serviceIdentifier.AgentInstance) as unknown as {
      workerConversationByAgentId: Map<string, string>;
      workerAgentIdByConversationId: Map<string, string>;
      workerConversationCleanupByAgentId: Map<string, () => void>;
      cleanupWorkerConversation: (agentId: string) => void;
    };
    vi.clearAllMocks();
    const agentId = 'agent-cleanup-failure-test';
    const conversationId = 'worker-conversation-cleanup-failure-test';
    service.workerConversationByAgentId.set(agentId, conversationId);
    service.workerAgentIdByConversationId.set(conversationId, agentId);
    service.workerConversationCleanupByAgentId.set(agentId, () => {
      throw new Error('unsubscribe failed');
    });

    expect(() => {
      service.cleanupWorkerConversation(agentId);
    }).not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      'MemeLoop UtilityProcess conversation cleanup failed during agent removal',
    );
    expect(service.workerConversationCleanupByAgentId.size).toBe(0);
    expect(service.workerAgentIdByConversationId.size).toBe(0);
    service.workerConversationByAgentId.delete(agentId);
  });
});
