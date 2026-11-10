import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentInstanceClient } from 'memeloop/mobile';

const state = vi.hoisted(() => ({
  getRunStatus: vi.fn(),
  cancel: vi.fn(),
  instanceClient: undefined as AgentInstanceClient | undefined,
}));
vi.mock('../deviceNetwork', () => ({ mobileDeviceNetwork: { start: async () => undefined } }));
vi.mock('@memeloop/react-ui/native', () => ({
  ConversationTimelineWindowController: class { dispose() {} },
}));
vi.mock('memeloop/mobile', () => ({
  createAgentDeviceRpcClient: () => ({
    getRunStatus: state.getRunStatus,
    cancel: state.cancel,
    getConversationMeta: async ({ conversationId }: { conversationId: string }) => ({
      meta: { conversationId, title: 'Test', definitionId: 'definition', lastMessageTimestamp: 0 },
    }),
  }),
  createAgentDeviceRpcRequestId: () => 'request',
  MAX_AGENT_CONVERSATION_APPENDED_MESSAGE_COUNT: 100,
  AgentSessionController: class {
    constructor(options: { agentInstanceClient: AgentInstanceClient }) { state.instanceClient = options.agentInstanceClient; }
    async start() {}
    stop() {}
  },
}));

import { createMobileRemoteAgentSession } from '../agentSession';

describe('remote run status notifications', () => {
  afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

  it('retains cancellation identity during a transport interruption and resumes status polling', async () => {
    vi.useFakeTimers();
    state.getRunStatus
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce({ status: { state: 'running' } })
      .mockResolvedValueOnce({ status: { state: 'completed' } });
    state.cancel.mockResolvedValue({ ok: true });
    const session = await createMobileRemoteAgentSession('desktop', undefined, {
      conversationId: 'conversation', title: 'Test', definitionId: 'definition', lastMessageTimestamp: 0,
      lastMessagePreview: '', messageCount: 0, originNodeId: 'desktop', originClock: 0, isUserInitiated: true,
    }, 'run');
    const listener = vi.fn();
    const unsubscribe = state.instanceClient!.subscribeToUpdates('conversation', listener);
    try {
      await session.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(listener.mock.calls.map(([update]) => update.status.state)).toEqual(['working']);
      expect(await state.instanceClient!.fetchAgent('conversation')).toMatchObject({ status: { state: 'working' } });
      await state.instanceClient!.cancelAgent('conversation');
      expect(state.cancel).toHaveBeenCalledWith({ runId: 'run' }, { signal: undefined });
      await vi.advanceTimersByTimeAsync(1499);
      expect(state.getRunStatus).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(751);
      expect(state.getRunStatus).toHaveBeenCalledTimes(3);
      expect(listener.mock.calls.map(([update]) => update.status.state)).toEqual(['working', 'completed']);
      await state.instanceClient!.cancelAgent('conversation');
      expect(state.cancel).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
      session.dispose();
    }
  });

  it('stops transport retries when the session is disposed', async () => {
    vi.useFakeTimers();
    state.getRunStatus.mockRejectedValue(new Error('peer unavailable'));
    const session = await createMobileRemoteAgentSession('desktop', undefined, {
      conversationId: 'conversation', title: 'Test', definitionId: 'definition', lastMessageTimestamp: 0,
      lastMessagePreview: '', messageCount: 0, originNodeId: 'desktop', originClock: 0, isUserInitiated: true,
    }, 'run');
    const listener = vi.fn();
    state.instanceClient!.subscribeToUpdates('conversation', listener);
    await session.start();
    await vi.advanceTimersByTimeAsync(0);
    session.dispose();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state.getRunStatus).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls.map(([update]) => update.status.state)).toEqual(['working']);
  });

  it.each([
    ['completed', 'completed'],
    ['failed', 'failed'],
    ['cancelled', 'canceled'],
  ])('emits working once through queued/running polls, followed by %s', async (remoteState, expectedState) => {
    vi.useFakeTimers();
    state.getRunStatus
      .mockResolvedValueOnce({ status: { state: 'queued' } })
      .mockResolvedValueOnce({ status: { state: 'running' } })
      .mockResolvedValueOnce({ status: { state: 'running' } })
      .mockResolvedValueOnce({ status: { state: remoteState } });
    const session = await createMobileRemoteAgentSession('desktop', undefined, {
      conversationId: 'conversation', title: 'Test', definitionId: 'definition', lastMessageTimestamp: 0,
      lastMessagePreview: '', messageCount: 0, originNodeId: 'desktop', originClock: 0, isUserInitiated: true,
    }, 'run');
    const listener = vi.fn();
    const unsubscribe = state.instanceClient!.subscribeToUpdates('conversation', listener);
    try {
      await session.start();
      await vi.advanceTimersByTimeAsync(2250);
      expect(state.getRunStatus).toHaveBeenCalledTimes(4);
      expect(listener.mock.calls.map(([update]) => update.status.state)).toEqual(['working', expectedState]);
    } finally {
      unsubscribe();
      session.dispose();
    }
  });
});
