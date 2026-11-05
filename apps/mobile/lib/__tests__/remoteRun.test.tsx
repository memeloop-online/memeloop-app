import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentInstanceClient } from 'memeloop/mobile';

const state = vi.hoisted(() => ({
  getRunStatus: vi.fn(),
  instanceClient: undefined as AgentInstanceClient | undefined,
}));
vi.mock('../deviceNetwork', () => ({ mobileDeviceNetwork: { start: async () => undefined } }));
vi.mock('@memeloop/react-ui/native', () => ({
  ConversationTimelineWindowController: class { dispose() {} },
}));
vi.mock('memeloop/mobile', () => ({
  createAgentDeviceRpcClient: () => ({
    getRunStatus: state.getRunStatus,
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
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

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
