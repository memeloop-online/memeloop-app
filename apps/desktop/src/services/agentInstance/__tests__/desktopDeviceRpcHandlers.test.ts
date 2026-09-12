import { AGENT_DEVICE_RPC_METHODS, type AgentRuntimeDeviceRpcHandlerOptions } from 'memeloop';
import { describe, expect, it, vi } from 'vitest';

import { createDesktopDeviceRpcHandlers } from '../desktopDeviceRpcHandlers';

const conversationId = 'conversation-1';
const definitionId = 'memeloop:general-assistant';
const remotePeerId = '12D3KooRemotePeer';

function createHandlerOptions(): AgentRuntimeDeviceRpcHandlerOptions {
  return {
    runtime: {
      createAgent: vi.fn(),
      sendMessage: vi.fn(),
      getRunStatus: vi.fn(),
      cancelRun: vi.fn(),
    },
    storage: {
      getConversationMeta: vi.fn().mockResolvedValue({
        conversationId,
        title: 'Conversation',
        lastMessagePreview: '',
        lastMessageTimestamp: 1,
        messageCount: 0,
        originNodeId: 'node-1',
        originClock: 1,
        definitionId,
        isUserInitiated: true,
      }),
      conversationReferencesAttachment: vi.fn(),
      getMessagePage: vi.fn().mockResolvedValue({
        reset: false,
        conversationId,
        revision: 'revision-1',
        items: [],
        hasMoreBefore: false,
        hasMoreAfter: false,
      }),
      getFullContentMessagePage: vi.fn(),
      getMessageIdentity: vi.fn(),
      readMessageDetailRange: vi.fn(),
      getMessageWindowAround: vi.fn(),
      getConversationTimelinePage: vi.fn(),
      readAttachmentRange: vi.fn(),
    },
    projections: {
      listConversations: vi.fn(),
      listTurns: vi.fn(),
      getTurnDetail: vi.fn(),
    },
    scheduledTaskHandler: vi.fn(),
  } as unknown as AgentRuntimeDeviceRpcHandlerOptions;
}

const pageRequest = {
  remotePeerId,
  method: AGENT_DEVICE_RPC_METHODS.getMessagePage,
  parameters: {
    conversationId,
    limit: 1,
    maxBytes: 64 * 1024,
  },
};

describe('createDesktopDeviceRpcHandlers', () => {
  it('allows local IPC pagination without a grant while network requests remain grant-gated', async () => {
    const { local, network } = createDesktopDeviceRpcHandlers(createHandlerOptions());

    await expect(local(pageRequest)).resolves.toMatchObject({
      reset: false,
      conversationId,
      revision: 'revision-1',
      items: [],
    });
    await expect(network(pageRequest)).rejects.toThrow(
      `rpc_permission_denied:${AGENT_DEVICE_RPC_METHODS.getMessagePage}`,
    );
  });
});
