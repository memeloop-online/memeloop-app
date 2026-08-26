import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentInstanceService } from '../index';

describe('AgentInstanceService durable send path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts exactly one Core run without invoking legacy framework hooks', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      runId: 'run-1',
      turnId: 'turn-generated-by-host',
      conversationId: 'conversation-1',
    });
    const service = new AgentInstanceService();
    const internals = service as unknown as Record<string, unknown>;
    internals.memeLoopWorker = { sendMessage };
    internals.agentDefinitionService = { getAgentDef: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(service, 'getAgentMetadata').mockResolvedValue({
      id: 'conversation-1',
      agentDefId: 'general-assistant',
      name: 'Assistant',
      status: { state: 'completed', modified: new Date() },
      created: new Date(),
      messages: [],
    });
    internals.ensureWorkerConversation = vi.fn().mockResolvedValue('conversation-1');

    await service.sendMsgToAgent('conversation-1', { text: 'hello' });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      'conversation-1',
      'hello',
      expect.objectContaining({
        requestId: expect.stringMatching(/:local$/),
        turnId: expect.any(String),
        userMessage: expect.objectContaining({
          conversationId: 'conversation-1',
          content: 'hello',
          messageId: expect.any(String),
        }),
      }),
    );
  });

  it('cancels the accepted run id instead of a host-local status token', async () => {
    const cancelRun = vi.fn().mockResolvedValue({ ok: true });
    const service = new AgentInstanceService();
    const internals = service as unknown as Record<string, unknown>;
    internals.memeLoopWorker = { cancelRun };
    internals.workerConversationByAgentId = new Map([['conversation-1', 'conversation-1']]);
    internals.workerActiveRunIdByConversationId = new Map([['conversation-1', 'run-1']]);
    internals.ensureMemeLoopWorkerHealthy = vi.fn().mockResolvedValue(undefined);

    await service.cancelAgent('conversation-1');

    expect(cancelRun).toHaveBeenCalledWith('conversation-1', 'run-1');
  });

  it('uses runtime conversation cancellation during the accept/cancel race', async () => {
    const cancelRun = vi.fn().mockResolvedValue({ ok: true });
    const service = new AgentInstanceService();
    const internals = service as unknown as Record<string, unknown>;
    internals.memeLoopWorker = { cancelRun };
    internals.workerConversationByAgentId = new Map([['conversation-1', 'conversation-1']]);
    internals.workerActiveRunIdByConversationId = new Map();
    internals.ensureMemeLoopWorkerHealthy = vi.fn().mockResolvedValue(undefined);

    await service.cancelAgent('conversation-1');

    expect(cancelRun).toHaveBeenCalledWith('conversation-1', undefined);
  });
});
