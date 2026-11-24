import type { IAgentInstanceService } from '@services/agentInstance/interface';
import { container } from '@services/container';
import { logger } from '@services/libs/log';
import serviceIdentifier from '@services/serviceIdentifier';
import { Subscription } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AgentInstanceService } from '../index';
import { AppAgentToolRuntime } from '../tools/runtime';

describe('AgentInstanceService worker cleanup', () => {
  it('retains host tools and framework schemas across an unhealthy worker restart, then disposes them at app shutdown', async () => {
    const service = new AgentInstanceService();
    const hostRuntime = new AppAgentToolRuntime();
    const execute = vi.fn((arguments_: Record<string, unknown>) => ({ value: arguments_.value }));
    hostRuntime.workerBridgeTools.register('host-echo', execute);
    const schema = { type: 'object', properties: { message: { type: 'string' } } };
    const internals = service as unknown as {
      agentToolRuntime?: AppAgentToolRuntime;
      frameworkSchemas: Map<string, Record<string, unknown>>;
      memeLoopWorker?: { ping: () => Promise<unknown>; shutdown: () => Promise<void> };
      memeLoopUtilityProcess?: { kill: () => boolean };
      workerConversationByAgentId: Map<string, string>;
      workerAgentIdByConversationId: Map<string, string>;
      workerConversationCleanupByAgentId: Map<string, () => void>;
      initializeMemeLoopWorker: () => Promise<void>;
      ensureMemeLoopWorkerHealthy: () => Promise<void>;
      requireAgentToolRuntime: () => AppAgentToolRuntime;
    };
    internals.agentToolRuntime = hostRuntime;
    internals.frameworkSchemas.set('restart-framework', schema);
    internals.workerConversationByAgentId.set('agent', 'conversation');
    internals.workerAgentIdByConversationId.set('conversation', 'agent');
    const cleanup = vi.fn();
    internals.workerConversationCleanupByAgentId.set('agent', cleanup);
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const kill = vi.fn(() => true);
    internals.memeLoopWorker = { ping: vi.fn().mockRejectedValue(new Error('worker disconnected')), shutdown };
    internals.memeLoopUtilityProcess = { kill };
    const initialize = vi.spyOn(internals, 'initializeMemeLoopWorker').mockImplementation(async () => {
      expect(internals.workerConversationByAgentId.get('agent')).toBe('conversation');
      const tools = internals.requireAgentToolRuntime();
      expect(tools).toBe(hostRuntime);
      expect(tools.workerBridgeTools.listTools()).toContain('host-echo');
      expect(tools.getAllRegisteredToolIds()).toContain('fullReplacement');
      expect(tools.getToolParameterSchema('fullReplacement')).toBeDefined();
      expect(service.getFrameworkConfigSchema('restart-framework')).toBe(schema);
      expect(await tools.workerBridgeTools.execute('host-echo', { value: 'after-restart' })).toEqual({ value: 'after-restart' });
      internals.memeLoopWorker = { ping: vi.fn().mockResolvedValue({ ok: true }), shutdown: vi.fn().mockResolvedValue(undefined) };
    });
    try {
      await Promise.all([internals.ensureMemeLoopWorkerHealthy(), internals.ensureMemeLoopWorkerHealthy()]);
      expect(initialize).toHaveBeenCalledTimes(1);
      expect(shutdown).toHaveBeenCalledTimes(1);
      expect(kill).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith({ value: 'after-restart' });
      expect(internals.agentToolRuntime).toBe(hostRuntime);
    } finally {
      await service.disposeMemeLoopWorker();
      initialize.mockRestore();
    }
    expect(internals.agentToolRuntime).toBeUndefined();
    expect(hostRuntime.workerBridgeTools.listTools()).toEqual([]);
    expect(internals.frameworkSchemas.size).toBe(0);
    expect(internals.workerConversationByAgentId.size).toBe(0);
  });

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
