import type { AgentConversationClient, AgentInstanceClient } from 'memeloop/mobile';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  instance: undefined as AgentInstanceClient | undefined,
  conversation: undefined as AgentConversationClient | undefined,
  rpc: {
    getMainConversation: vi.fn(),
    getConversationMeta: vi.fn(),
    getDefinitions: vi.fn(),
    getMessagePage: vi.fn(),
    createAgent: vi.fn(),
    prepareStartTurn: vi.fn(),
    startTurn: vi.fn(),
    getRunStatus: vi.fn(),
    send: vi.fn(),
    cancel: vi.fn(),
    goals: { start: vi.fn() },
  },
}));
vi.mock('../deviceNetwork', () => ({ mobileDeviceNetwork: { start: async () => undefined } }));
vi.mock('@memeloop/react-ui/native', () => ({ ConversationTimelineWindowController: class { dispose() {} } }));
vi.mock('memeloop/mobile', () => ({
  createAgentDeviceRpcClient: () => state.rpc,
  createAgentDeviceRpcRequestId: () => 'request',
  MAX_AGENT_CONVERSATION_APPENDED_MESSAGE_COUNT: 100,
  AgentSessionController: class {
    constructor(options: { agentInstanceClient: AgentInstanceClient; conversationClient: AgentConversationClient }) {
      state.instance = options.agentInstanceClient;
      state.conversation = options.conversationClient;
    }
    async start() {}
    stop() {}
  },
}));

import { createMobileRemoteAgentSession, createMobileRemoteConversation } from '../agentSession';

const main = {
  conversationId: 'custom-main', definitionId: 'user:research-agent', title: 'My research agent',
  lastMessageTimestamp: 1000, lastMessagePreview: 'Research results', messageCount: 2,
  originNodeId: 'desktop', originClock: 1, isUserInitiated: true,
};

describe('remote custom agent identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.rpc.getMainConversation.mockResolvedValue({ conversation: main });
    state.rpc.getConversationMeta.mockImplementation(async ({ conversationId }) => ({ meta: { ...main, conversationId } }));
    state.rpc.getDefinitions.mockResolvedValue({
      definitions: [{ id: main.definitionId, name: 'Research agent', loopId: 'memeloop:agent-agent-loop', agentFrameworkID: 'legacy-framework' }],
    });
    state.rpc.prepareStartTurn.mockImplementation(input => input);
    state.rpc.startTurn.mockResolvedValue({ runId: 'custom-run' });
    state.rpc.send.mockResolvedValue({ runId: 'branch-run' });
    state.rpc.getRunStatus.mockResolvedValue({ status: { state: 'running' } });
  });
  afterEach(() => vi.useRealTimers());

  it('loads custom main metadata and history and prefers the canonical loop identifier', async () => {
    const session = await createMobileRemoteAgentSession('desktop');
    try {
      expect(session.definitionId).toBe(main.definitionId);
      expect(session.title).toBe(main.title);
      expect(await state.instance!.fetchAgent(main.conversationId)).toMatchObject({
        id: main.conversationId, agentDefId: main.definitionId, name: main.title,
      });
      expect(await state.instance!.getAgentFrameworkId!(main.conversationId)).toBe('memeloop:agent-agent-loop');
      const history = { items: [{ messageId: 'research-result', content: 'Custom result' }], revision: 'r1' };
      state.rpc.getMessagePage.mockResolvedValue(history);
      expect(await state.conversation!.getMessagePage(main.conversationId, { limit: 50, maxBytes: 262144 })).toBe(history);
      expect(state.rpc.getMessagePage).toHaveBeenCalledWith({ conversationId: main.conversationId, limit: 50, maxBytes: 262144 }, { signal: undefined });
      await session.client.goals.start({ conversationId: session.conversationId, definitionId: session.definitionId, objective: 'Finish research' });
      expect(state.rpc.goals.start).toHaveBeenCalledWith({ conversationId: main.conversationId, definitionId: main.definitionId, objective: 'Finish research' });
    } finally { session.dispose(); }
  });

  it('refreshes a selected history entry before exposing the goal definition', async () => {
    const session = await createMobileRemoteAgentSession('desktop', undefined, { ...main, definitionId: 'stale-definition' });
    try {
      expect(session.definitionId).toBe(main.definitionId);
      expect(state.rpc.getMainConversation).not.toHaveBeenCalled();
    } finally { session.dispose(); }
  });

  it('sends with canonical conversation definition and cancels its tracked run', async () => {
    vi.useFakeTimers();
    const session = await createMobileRemoteAgentSession('desktop');
    try {
      await state.conversation!.sendMessage(main.conversationId, 'Continue research');
      expect(state.rpc.prepareStartTurn).toHaveBeenCalledWith({
        kind: 'send', request: { conversationId: main.conversationId, definitionId: main.definitionId, message: 'Continue research' },
      });
      await state.instance!.cancelAgent(main.conversationId);
      expect(state.rpc.cancel).toHaveBeenCalledWith({ runId: 'custom-run' }, { signal: undefined });
    } finally { session.dispose(); }
  });

  it('continues an edited branch using its canonical target definition', async () => {
    const session = await createMobileRemoteAgentSession('desktop');
    state.rpc.getConversationMeta.mockResolvedValueOnce({ meta: { ...main, conversationId: 'branch', definitionId: 'user:updated-research-agent' } });
    try {
      await expect(session.acceptBranch({
        conversationId: main.conversationId, messageId: 'source-message', targetConversationId: 'branch',
        replacementMessageId: 'edited-message', requestId: 'edit-request', sourceRevision: 'source-r1', text: 'Edited research',
      })).resolves.toBe('branch-run');
      expect(state.rpc.send).toHaveBeenCalledWith({
        conversationId: 'branch', definitionId: 'user:updated-research-agent', requestId: 'edit-request', turnId: 'edited-message', message: 'Edited research',
      });
    } finally { session.dispose(); }
  });

  it('restores cancellation tracking when opening a custom branch run', async () => {
    vi.useFakeTimers();
    const session = await createMobileRemoteAgentSession('desktop', undefined, { ...main, conversationId: 'branch' }, 'branch-run');
    try {
      await session.start();
      expect(session.definitionId).toBe(main.definitionId);
      await state.instance!.cancelAgent('branch');
      expect(state.rpc.cancel).toHaveBeenCalledWith({ runId: 'branch-run' }, { signal: undefined });
    } finally { session.dispose(); }
  });

  it('creates the selected custom definition and returns host canonical metadata', async () => {
    const session = await createMobileRemoteAgentSession('desktop');
    const signal = new AbortController().signal;
    state.rpc.createAgent.mockResolvedValue({ conversationId: 'new-custom' });
    try {
      const created = await createMobileRemoteConversation(session.client, main.definitionId, 'new-custom', signal);
      expect(created).toEqual({ ...main, conversationId: 'new-custom' });
      expect(state.rpc.createAgent).toHaveBeenCalledWith({ definitionId: main.definitionId, conversationId: 'new-custom' }, { signal });
      expect(state.rpc.getConversationMeta).toHaveBeenLastCalledWith({ conversationId: 'new-custom' }, { signal });
    } finally { session.dispose(); }
  });

  it('reuses an explicit creation identity after the metadata response is lost', async () => {
    const session = await createMobileRemoteAgentSession('desktop');
    state.rpc.createAgent.mockResolvedValue({ conversationId: 'new-custom' });
    state.rpc.getConversationMeta.mockRejectedValueOnce(new Error('connection lost after creation'));
    try {
      await expect(createMobileRemoteConversation(session.client, main.definitionId, 'new-custom')).rejects.toThrow('connection lost');
      await expect(createMobileRemoteConversation(session.client, main.definitionId, 'new-custom')).resolves.toMatchObject({ conversationId: 'new-custom' });
      expect(state.rpc.createAgent.mock.calls.map(([input]) => input)).toEqual([
        { definitionId: main.definitionId, conversationId: 'new-custom' },
        { definitionId: main.definitionId, conversationId: 'new-custom' },
      ]);
    } finally { session.dispose(); }
  });
});
