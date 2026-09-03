import {
  type AgentConversationClient,
  type AgentConversationUpdate,
  type AgentDeviceRpcClient,
  type AgentInstanceClient,
  type AgentRuntimeView,
  AgentSessionController,
  createAgentDeviceRpcClient,
  createAgentDeviceRpcRequestId,
  MAX_AGENT_CONVERSATION_APPENDED_MESSAGE_COUNT,
} from 'memeloop/mobile';
import { ConversationTimelineWindowController } from '@memeloop/react-ui/native';

import { mobileDeviceNetwork } from './deviceNetwork';
export { MOBILE_ATTACHMENT_HOST, selectMobileAgentDevice } from './agentSessionPolicy';

export const MOBILE_SESSION_MESSAGE_LIMIT = 50;
export const MOBILE_SESSION_BYTE_LIMIT = 256 * 1024;
const MOBILE_CONVERSATION_HEAD_POLL_MS = 1_500;
const MOBILE_REMOTE_RUN_POLL_MS = 750;
const MOBILE_CONVERSATION_UPDATE_FALLBACK_MS = MOBILE_CONVERSATION_HEAD_POLL_MS;

interface ConversationHead {
  revision: string;
  totalMessages: number;
}

interface MobileConversationUpdateSourceContext {
  conversationId: string;
  listener: (update: AgentConversationUpdate) => void;
  abortController: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  head?: ConversationHead;
  readInFlight: boolean;
  refreshQueued: boolean;
  consecutiveFailures: number;
}

/** Mobile's host-owned revision probe; only bounded invalidations cross the Core adapter boundary. */
class MobileConversationUpdateSource {
  private active?: MobileConversationUpdateSourceContext;
  private disposed = false;

  constructor(
    private readonly readHead: (
      conversationId: string,
      signal: AbortSignal,
    ) => Promise<ConversationHead>,
  ) {}

  subscribe(
    conversationId: string,
    listener: (update: AgentConversationUpdate) => void,
  ): () => void {
    if (this.disposed) throw new Error('mobile_conversation_update_source_disposed');
    this.clearActive();
    const context: MobileConversationUpdateSourceContext = {
      conversationId,
      listener,
      abortController: new AbortController(),
      readInFlight: false,
      refreshQueued: false,
      consecutiveFailures: 0,
    };
    this.active = context;
    void this.read(context);
    return () => {
      if (this.active !== context) return;
      this.clearActive();
    };
  }

  wake(conversationId?: string): void {
    if (this.disposed) return;
    const context = this.active;
    if (!context || (conversationId !== undefined && conversationId !== context.conversationId)) return;
    if (context.readInFlight) {
      context.refreshQueued = true;
      return;
    }
    this.schedule(context, 0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.clearActive();
    this.disposed = true;
  }

  private async read(context: MobileConversationUpdateSourceContext): Promise<void> {
    if (!this.isCurrent(context) || context.readInFlight) return;
    this.clearTimer(context);
    context.readInFlight = true;
    try {
      const head = await this.readHead(context.conversationId, context.abortController.signal);
      if (!this.isCurrent(context)) return;
      this.assertHead(head);
      const previous = context.head;
      context.head = head;
      context.consecutiveFailures = 0;
      if (previous && previous.revision !== head.revision) {
        const appendedMessageCount = head.totalMessages - previous.totalMessages;
        const update: AgentConversationUpdate = appendedMessageCount > 0 && appendedMessageCount <= MAX_AGENT_CONVERSATION_APPENDED_MESSAGE_COUNT
          ? {
            kind: 'invalidated',
            conversationId: context.conversationId,
            previousRevision: previous.revision,
            revision: head.revision,
            reason: 'append',
            appendedMessageCount,
          }
          : {
            kind: 'invalidated',
            conversationId: context.conversationId,
            previousRevision: previous.revision,
            revision: head.revision,
            reason: 'reset',
          };
        this.emit(context, update);
      } else if (previous && previous.totalMessages !== head.totalMessages) {
        // A revision identifies the total. Re-baseline instead of forging an
        // invalidation with equal revisions.
        context.head = undefined;
        context.refreshQueued = true;
      }
    } catch {
      if (this.isCurrent(context)) context.consecutiveFailures = Math.min(context.consecutiveFailures + 1, 5);
    } finally {
      context.readInFlight = false;
      if (this.isCurrent(context)) {
        if (context.refreshQueued) {
          context.refreshQueued = false;
          this.schedule(context, 0);
        } else {
          this.schedule(context, MOBILE_CONVERSATION_UPDATE_FALLBACK_MS * 2 ** context.consecutiveFailures);
        }
      }
    }
  }

  private emit(context: MobileConversationUpdateSourceContext, update: AgentConversationUpdate): void {
    if (!this.isCurrent(context)) return;
    try {
      context.listener(update);
    } catch {
      // Listener failures cannot break the host probe or cleanup fences.
      if (this.isCurrent(context)) {
        context.consecutiveFailures = Math.min(context.consecutiveFailures + 1, 5);
      }
    }
  }

  private schedule(context: MobileConversationUpdateSourceContext, delayMs: number): void {
    if (!this.isCurrent(context)) return;
    this.clearTimer(context);
    context.timer = setTimeout(() => {
      context.timer = undefined;
      void this.read(context);
    }, delayMs);
  }

  private clearActive(): void {
    const context = this.active;
    this.active = undefined;
    if (!context) return;
    context.abortController.abort();
    this.clearTimer(context);
  }

  private clearTimer(context: MobileConversationUpdateSourceContext): void {
    if (context.timer === undefined) return;
    clearTimeout(context.timer);
    context.timer = undefined;
  }

  private isCurrent(context: MobileConversationUpdateSourceContext): boolean {
    return this.active === context && !this.disposed && !context.abortController.signal.aborted;
  }

  private assertHead(head: ConversationHead): void {
    if (!head || typeof head.revision !== 'string' || head.revision.length === 0 || !Number.isSafeInteger(head.totalMessages) || head.totalMessages < 0) {
      throw new Error('invalid_mobile_conversation_head');
    }
  }
}

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
  private readonly updateSource: MobileConversationUpdateSource;
  private readonly agentListeners = new Map<string, Set<(update: Partial<AgentRuntimeView>) => void>>();
  private readonly runControllers = new Map<string, AbortController>();
  private readonly activeRunIds = new Map<string, string>();
  private disposed = false;

  constructor(readonly client: AgentDeviceRpcClient) {
    this.updateSource = new MobileConversationUpdateSource(async (conversationId, signal) => {
      const page = await this.client.getConversationTimelinePage({
        conversationId,
        limit: 1,
        maxBytes: 64 * 1024,
      }, { signal });
      if (page.reset) throw new Error('unexpected_conversation_timeline_head_reset');
      return { revision: page.revision, totalMessages: page.totalMessages };
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
          status: {
            state: this.activeRunIds.has(agentId) ? 'working' : 'idle',
            modified: new Date(meta.lastMessageTimestamp),
          },
          created: new Date(meta.lastMessageTimestamp),
          modified: new Date(meta.lastMessageTimestamp),
          closed: false,
          volatile: false,
          preview: false,
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
          ...(options.direction ? { direction: options.direction } : {}),
          ...(options.cursor ? { cursor: options.cursor } : {}),
          ...(options.expectedRevision ? { expectedRevision: options.expectedRevision } : {}),
        }, { signal: callOptions?.signal });
        return page;
      },
      getMessageWindowAround: async (request, options) => {
        const result = await this.client.loadAround({
          conversationId: request.conversationId,
          focus: request.focus,
          expectedRevision: request.expectedRevision,
          maxMessages: request.maxMessages,
          maxBytes: request.maxBytes,
        }, { signal: options?.signal });
        return result;
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
