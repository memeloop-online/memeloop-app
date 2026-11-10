import { describe, expect, it, vi } from 'vitest';
import * as repo from '../agentRepository';
import { cancelDesktopGoalRun } from '../goalLifecycle';
import { AgentInstanceService } from '../index';
import * as scheduling from '../scheduledTaskManager';
import * as mcp from '../tools/modelContextProtocol';

describe('desktop goal cancellation', () => {
  it('pauses a goal before cancelling an accepted run from a network stop request', async () => {
    const order: string[] = [];
    const goals = {
      pauseConversation: vi.fn(async () => {
        order.push('pause');
        return null;
      }),
    };
    const runtime = {
      getRunStatus: vi.fn().mockResolvedValue({ conversationId: 'conversation' }),
      cancelRun: vi.fn(async () => {
        order.push('cancel');
        return true;
      }),
      cancelAgent: vi.fn(),
    };
    await expect(cancelDesktopGoalRun(runtime, goals, { runId: 'run' })).resolves.toBe(true);
    expect(goals.pauseConversation).toHaveBeenCalledWith('conversation');
    expect(order).toEqual(['pause', 'cancel']);
  });

  it('pauses between rounds when closing a conversation before its next run exists', async () => {
    const goals = { pauseConversation: vi.fn().mockResolvedValue(null) };
    const runtime = { getRunStatus: vi.fn(), cancelRun: vi.fn(), cancelAgent: vi.fn().mockResolvedValue(undefined) };
    await cancelDesktopGoalRun(runtime, goals, { conversationId: 'conversation' });
    expect(goals.pauseConversation).toHaveBeenCalledWith('conversation');
    expect(runtime.cancelAgent).toHaveBeenCalledWith('conversation');
    expect(runtime.getRunStatus).not.toHaveBeenCalled();
  });

  it('preserves the runtime result when a requested run is already gone', async () => {
    const goals = { pauseConversation: vi.fn() };
    const runtime = { getRunStatus: vi.fn().mockResolvedValue(undefined), cancelRun: vi.fn().mockResolvedValue(false), cancelAgent: vi.fn() };
    await expect(cancelDesktopGoalRun(runtime, goals, { runId: 'missing' })).resolves.toBe(false);
    expect(goals.pauseConversation).not.toHaveBeenCalled();
  });

  it('reports success when pausing the goal already cancelled its run', async () => {
    const goals = { pauseConversation: vi.fn().mockResolvedValue({ status: 'paused', pendingRound: { runId: 'run' } }) };
    const runtime = {
      getRunStatus: vi.fn().mockResolvedValue({ conversationId: 'conversation' }),
      cancelRun: vi.fn().mockResolvedValue(false),
      cancelAgent: vi.fn(),
    };
    await expect(cancelDesktopGoalRun(runtime, goals, { runId: 'run' })).resolves.toBe(true);
  });

  it.each(['closeAgent', 'deleteAgent'] as const)('%s stops restored goal work before changing the conversation projection', async method => {
    const order: string[] = [];
    const cancelRun = vi.fn(async () => {
      order.push('stop');
      return { ok: true };
    });
    const service = new AgentInstanceService();
    Object.assign(service, {
      memeLoopWorker: { cancelRun },
      ensureRepositories: vi.fn(),
      ensureMemeLoopWorkerHealthy: vi.fn().mockResolvedValue(undefined),
      agentInstanceRepository: {
        findOne: vi.fn().mockResolvedValue({ id: 'conversation', closed: false }),
        save: vi.fn(async () => {
          order.push('projection');
        }),
      },
      agentMessageRepository: {},
    });
    const cancelTasks = vi.spyOn(scheduling, 'cancelTasksForAgent').mockResolvedValue(undefined);
    const deleteTasks = vi.spyOn(scheduling, 'deleteTasksForAgent').mockResolvedValue(undefined);
    const cleanupMCP = vi.spyOn(mcp, 'cleanupMCPClient').mockResolvedValue(undefined);
    const deleteAgent = vi.spyOn(repo, 'deleteAgent').mockImplementation(async () => {
      order.push('projection');
    });
    try {
      await service[method]('conversation');
      expect(cancelRun).toHaveBeenCalledWith('conversation', undefined);
      expect(order).toEqual(['stop', 'projection']);
    } finally {
      cancelTasks.mockRestore();
      deleteTasks.mockRestore();
      cleanupMCP.mockRestore();
      deleteAgent.mockRestore();
    }
  });
});
