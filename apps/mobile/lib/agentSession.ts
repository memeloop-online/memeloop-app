import {
  type AgentConversationClient,
  type AgentDeviceRpcClient,
  type AgentInstanceClient,
  type AgentRuntimeView,
  AgentSessionController,
  createAgentDeviceRpcClient,
  createAgentDeviceRpcRequestId,
  PollingAgentConversationUpdateSource,
  projectConversationMessageForList,
} from 'memeloop/mobile';
import { ConversationTimelineWindowController } from '@memeloop/react-ui/native';

import { mobileDeviceNetwork } from './deviceNetwork';
export { MOBILE_ATTACHMENT_HOST, selectMobileAgentDevice } from './agentSessionPolicy';

export const MOBILE_SESSION_MESSAGE_LIMIT = 50;
export const MOBILE_SESSION_BYTE_LIMIT = 256 * 1024;
const MOBILE_CONVERSATION_HEAD_POLL_MS = 1_500;
const MOBILE_REMOTE_RUN_POLL_MS = 750;

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const finish = (): void => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    const abort = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

class RemoteAgentRuntimeBridge {
  private readonly updateSource: PollingAgentConversationUpdateSource;
  private readonly agentListeners = new Map<string, Set<(update: Partial<AgentRuntimeView>) => void>>();
  private readonly runControllers = new Map<string, AbortController>();
  private readonly activeRunIds = new Map<string, string>();
  private disposed = false;

  constructor(readonly client: AgentDeviceRpcClient) {
    this.updateSource = new PollingAgentConversationUpdateSource({
      pollIntervalMs: MOBILE_CONVERSATION_HEAD_POLL_MS,
      readHead: async ({ conversationId, signal }) => {
        const page = await this.client.getConversationTimelinePage({
          conversationId,
          limit: 1,
          maxBytes: 64 * 1024,
        }, { signal });
        if (page.reset) throw new Error('unexpected_conversation_timeline_head_reset');
        return { revision: page.revision, totalMessages: page.totalMessages };
      },
    });
  }

  createInstanceClient(): AgentInstanceClient {
    return {
      createAgent: async (agentDefinitionId, options) => {
        throwIfAborted(options?.signal);
        const result = await this.client.createAgent({ definitionId: agentDefinitionId }, { signal: options?.signal });
        return { id: result.conversationId };
      },
      fetchAgent: async (agentId, options) => {
        throwIfAborted(options?.signal);
        const { meta } = await this.client.getConversationMeta({ conversationId: agentId }, { signal: options?.signal });
        if (!meta) throw new Error('remote_agent_conversation_not_found');
        return {
          id: meta.conversationId,
          name: meta.title || 'Remote agent',
          agentDefId: meta.definitionId,
          status: { state: this.activeRunIds.has(agentId) ? 'working' : 'idle' },
        };
      },
      updateAgent: async () => {
        throw new Error('remote_agent_update_not_supported');
      },
      cancelAgent: async (agentId, options) => {
        throwIfAborted(options?.signal);
        const runId = this.activeRunIds.get(agentId);
        if (!runId) return;
        await this.client.cancel({ runId }, { signal: options?.signal });
      },
      deleteAgent: async () => {
        throw new Error('remote_agent_delete_not_supported');
      },
      subscribeToUpdates: (agentId, listener) => {
        const listeners = this.agentListeners.get(agentId) ?? new Set();
        listeners.add(listener);
        this.agentListeners.set(agentId, listeners);
        return () => {
          listeners.delete(listener);
          if (listeners.size === 0) this.agentListeners.delete(agentId);
        };
      },
      getAgentFrameworkId: async (agentId, options) => {
        const { meta } = await this.client.getConversationMeta({ conversationId: agentId }, { signal: options?.signal });
        if (!meta) throw new Error('remote_agent_conversation_not_found');
        const { definitions } = await this.client.getDefinitions({}, { signal: options?.signal });
        return definitions.find(definition => definition.id === meta.definitionId)?.agentFrameworkID ?? 'memeloop:agent-tool-loop';
      },
      getFrameworkConfigSchema: async () => {
        throw new Error('remote_framework_schema_not_supported');
      },
    };
  }

  createConversationClient(): AgentConversationClient {
    return {
      getMessagePage: async (conversationId, options, callOptions) => {
        const page = await this.client.getMessagePage({
          conversationId,
          limit: options.limit,
          maxBytes: options.maxBytes,
          ...(options.mode ? { mode: options.mode } : {}),
          ...(options.direction ? { direction: options.direction } : {}),
          ...(options.cursor ? { cursor: options.cursor } : {}),
          ...(options.expectedRevision ? { expectedRevision: options.expectedRevision } : {}),
        }, { signal: callOptions?.signal });
        return page.reset ? page : {
          ...page,
          items: page.items.map(projectConversationMessageForList),
        };
      },
      getMessageWindowAround: async (request, options) => {
        const result = await this.client.loadAround({
          conversationId: request.conversationId,
          focus: request.focus,
          expectedRevision: request.expectedRevision,
          maxMessages: request.maxMessages,
          maxBytes: request.maxBytes,
        }, { signal: options?.signal });
        return result.reset ? result : {
          ...result,
          items: result.items.map(projectConversationMessageForList),
        };
      },
      getTurnDetail: (request, options) => this.client.getTurnDetail(request, { signal: options?.signal }),
      sendMessage: async (conversationId, content, attachment, wikiTiddlers, options) => {
        throwIfAborted(options?.signal);
        if (attachment || (wikiTiddlers && wikiTiddlers.length > 0)) {
          throw new Error('mobile_attachments_not_supported');
        }
        const { meta } = await this.client.getConversationMeta({ conversationId }, { signal: options?.signal });
        if (!meta) throw new Error('remote_agent_conversation_not_found');
        const prepared = this.client.prepareStartTurn({
          kind: 'send',
          request: {
            conversationId,
            definitionId: meta.definitionId,
            message: content,
          },
        });
        const accepted = await this.client.startTurn(prepared, { signal: options?.signal });
        this.trackRun(conversationId, accepted.runId);
        this.updateSource.wake(conversationId);
      },
      subscribeToMessages: (conversationId, listener) => this.updateSource.subscribe(conversationId, listener),
      deleteTurn: async (request, options) => {
        const result = await this.client.deleteTurn(request, { signal: options?.signal });
        this.updateSource.wake(request.conversationId);
        return result;
      },
      retryTurn: async (request, options) => {
        const result = await this.client.retryTurn(request, { signal: options?.signal });
        this.trackRun(request.conversationId, result.runId);
        this.updateSource.wake(request.conversationId);
        return result;
      },
    };
  }

  createTimelineController(): ConversationTimelineWindowController {
    return new ConversationTimelineWindowController({
      getPage: (request, options) => this.client.getConversationTimelinePage(request, options),
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.updateSource.dispose();
    for (const controller of this.runControllers.values()) controller.abort();
    this.runControllers.clear();
    this.activeRunIds.clear();
    this.agentListeners.clear();
  }

  private trackRun(conversationId: string, runId: string): void {
    this.runControllers.get(conversationId)?.abort();
    const controller = new AbortController();
    this.runControllers.set(conversationId, controller);
    this.activeRunIds.set(conversationId, runId);
    this.emit(conversationId, { status: { state: 'working' } });
    void this.pollRun(conversationId, runId, controller.signal);
  }

  private async pollRun(conversationId: string, runId: string, signal: AbortSignal): Promise<void> {
    try {
      for (;;) {
        const { status } = await this.client.getRunStatus({ runId }, { signal });
        if (!status) {
          this.emit(conversationId, { status: { state: 'failed' } });
          return;
        }
        if (status.state === 'completed') {
          this.emit(conversationId, { status: { state: 'completed' } });
          return;
        }
        if (status.state === 'failed') {
          this.emit(conversationId, { status: { state: 'failed' } });
          return;
        }
        if (status.state === 'cancelled') {
          this.emit(conversationId, { status: { state: 'canceled' } });
          return;
        }
        this.emit(conversationId, { status: { state: 'working' } });
        await wait(MOBILE_REMOTE_RUN_POLL_MS, signal);
      }
    } catch {
      if (!signal.aborted) this.emit(conversationId, { status: { state: 'failed' } });
    } finally {
      if (this.activeRunIds.get(conversationId) === runId) {
        this.activeRunIds.delete(conversationId);
        this.runControllers.delete(conversationId);
        this.updateSource.wake(conversationId);
      }
    }
  }

  private emit(agentId: string, update: Partial<AgentRuntimeView>): void {
    for (const listener of this.agentListeners.get(agentId) ?? []) listener(update);
  }
}

export interface MobileRemoteAgentSession {
  readonly peerId: string;
  readonly conversationId: string;
  readonly title: string;
  readonly controller: AgentSessionController;
  readonly timelineController: ConversationTimelineWindowController;
  start(): Promise<void>;
  dispose(): void;
}

export async function createMobileRemoteAgentSession(peerId: string, signal?: AbortSignal): Promise<MobileRemoteAgentSession> {
  throwIfAborted(signal);
  await mobileDeviceNetwork.start();
  throwIfAborted(signal);
  const client = createAgentDeviceRpcClient({
    peerId,
    createRequestId: createAgentDeviceRpcRequestId,
    sendRpc: (targetPeerId, method, parameters, options) =>
      mobileDeviceNetwork.getService().sendRpc(targetPeerId, method, parameters, options),
  });
  const latest = await client.listConversations({ limit: 1, direction: 'backward' }, { signal });
  let conversation = latest.items[0];
  if (!conversation) {
    const { definitions } = await client.getDefinitions({}, { signal });
    const definition = definitions[0];
    if (!definition) throw new Error('remote_agent_definition_not_found');
    const created = await client.createAgent({ definitionId: definition.id }, { signal });
    const response = await client.getConversationMeta({ conversationId: created.conversationId }, { signal });
    conversation = response.meta ?? {
      conversationId: created.conversationId,
      definitionId: definition.id,
      title: definition.name,
      lastMessagePreview: '',
      lastMessageTimestamp: 0,
      messageCount: 0,
      originNodeId: peerId,
      originClock: 0,
      isUserInitiated: true,
    };
  }
  throwIfAborted(signal);
  const bridge = new RemoteAgentRuntimeBridge(client);
  const controller = new AgentSessionController({
    agentInstanceClient: bridge.createInstanceClient(),
    conversationClient: bridge.createConversationClient(),
    maxResidentMessages: MOBILE_SESSION_MESSAGE_LIMIT,
    maxResidentBytes: MOBILE_SESSION_BYTE_LIMIT,
  });
  const timelineController = bridge.createTimelineController();
  let disposed = false;
  return {
    peerId,
    conversationId: conversation.conversationId,
    title: conversation.title || 'Remote agent',
    controller,
    timelineController,
    async start() {
      if (disposed) throw new Error('mobile_agent_session_disposed');
      await controller.start({
        agentId: conversation.conversationId,
        conversationId: conversation.conversationId,
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.stop();
      timelineController.dispose();
      bridge.dispose();
    },
  };
}
