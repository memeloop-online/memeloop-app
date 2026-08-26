import { Sha256 } from '@aws-crypto/sha256-js';
import { ConversationTimelineWindowController, type MemeLoopMessageDetailLoader, validateMessageDetailPage } from '@memeloop/react-ui/chat';
import {
  type AgentConversationClient,
  type AgentInstanceClient,
  type AgentRuntimeView,
  AgentSessionController,
  type BeginAttachmentUploadRequest,
  type CommitAttachmentUploadRequest,
  createAttachmentUploadRpcClient,
  PollingAgentConversationUpdateSource,
  type UploadAttachmentChunkRequest,
} from 'memeloop';
import { nanoid } from 'nanoid';

import { DEFAULT_AGENT_FRAMEWORK_ID } from '@services/agentInstance/defaultAgentFrameworkId';
import type { AgentInstanceUpdate } from '@services/agentInstance/interface';
import type { AgentInstance } from '@services/agentInstance/interface';

export const DESKTOP_SESSION_MESSAGE_LIMIT = 50;
export const DESKTOP_SESSION_BYTE_LIMIT = 256 * 1024;
export const DESKTOP_SESSION_UPDATE_FALLBACK_MS = 30_000;

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function runtimeView(update: AgentInstanceUpdate['agent']): AgentRuntimeView {
  const state = update.status.state === 'submitted' || update.status.state === 'unknown'
    ? 'idle'
    : update.status.state;
  return {
    id: update.id,
    name: update.name ?? '',
    agentDefId: update.agentDefId,
    status: {
      state,
      ...(update.status.message?.content ? { progress: update.status.message.content } : {}),
    },
  };
}

function createAgentInstanceClient(): AgentInstanceClient {
  return {
    async createAgent(agentDefinitionId, options) {
      throwIfAborted(options?.signal);
      const agent = await window.service.agentInstance.createAgent(agentDefinitionId, {
        preview: options?.preview,
      });
      throwIfAborted(options?.signal);
      return { id: agent.id };
    },
    async fetchAgent(agentId, options) {
      throwIfAborted(options?.signal);
      const agent = await window.service.agentInstance.getAgentMetadata(agentId);
      throwIfAborted(options?.signal);
      if (!agent) throw new Error(`agent_not_found:${agentId}`);
      const { messages: _messages, ...metadata } = agent;
      return runtimeView(metadata);
    },
    async updateAgent(agentId, data, options) {
      throwIfAborted(options?.signal);
      const agent = await window.service.agentInstance.updateAgent(agentId, data as Partial<AgentInstance>);
      throwIfAborted(options?.signal);
      const { messages: _messages, ...metadata } = agent;
      return runtimeView(metadata);
    },
    async cancelAgent(agentId, options) {
      throwIfAborted(options?.signal);
      await window.service.agentInstance.cancelAgent(agentId);
      throwIfAborted(options?.signal);
    },
    async deleteAgent(agentId, options) {
      throwIfAborted(options?.signal);
      await window.service.agentInstance.deleteAgent(agentId);
      throwIfAborted(options?.signal);
    },
    subscribeToUpdates(agentId, listener) {
      const subscription = window.observables.agentInstance.subscribeToAgentUpdates(agentId).subscribe({
        next: update => {
          if (update?.agent.id === agentId) listener(runtimeView(update.agent));
        },
      });
      return () => {
        subscription.unsubscribe();
      };
    },
    getAgentFrameworkId: agentId =>
      window.service.agentInstance.getAgentMetadata(agentId).then(async agent => {
        if (!agent) throw new Error(`agent_not_found:${agentId}`);
        const definition = await window.service.agentDefinition.getAgentDef(agent.agentDefId);
        return definition?.agentFrameworkID ?? DEFAULT_AGENT_FRAMEWORK_ID;
      }),
    getFrameworkConfigSchema: frameworkId => window.service.agentInstance.getFrameworkConfigSchema(frameworkId),
  };
}

export function createDesktopConversationClient(): AgentConversationClient {
  const updateSource = new PollingAgentConversationUpdateSource({
    pollIntervalMs: DESKTOP_SESSION_UPDATE_FALLBACK_MS,
    readHead: async ({ conversationId, signal }) => {
      signal.throwIfAborted();
      const page = await window.service.agentInstance.getAgentConversationTimelinePage({
        conversationId,
        limit: 1,
        maxBytes: 64 * 1024,
      });
      signal.throwIfAborted();
      if (page.reset) throw new Error('unexpected_conversation_timeline_head_reset');
      return { revision: page.revision, totalMessages: page.totalMessages };
    },
  });

  return {
    async getMessagePage(conversationId, options, callOptions) {
      throwIfAborted(callOptions?.signal);
      const page = await window.service.agentInstance.getAgentConversationMessagePage(conversationId, options);
      throwIfAborted(callOptions?.signal);
      return page;
    },
    async getMessageWindowAround(request, callOptions) {
      throwIfAborted(callOptions?.signal);
      const result = await window.service.agentInstance.getAgentConversationMessageWindow(request);
      throwIfAborted(callOptions?.signal);
      return result;
    },
    async getTurnDetail(request, callOptions) {
      throwIfAborted(callOptions?.signal);
      const result = await window.service.agentInstance.getAgentConversationTurnDetail(request);
      throwIfAborted(callOptions?.signal);
      return result;
    },
    async sendMessage(conversationId, content, attachment, wikiTiddlers, options) {
      throwIfAborted(options?.signal);
      if (attachment?.kind === 'source') throw new Error('uncommitted_attachment_send_not_supported');
      await window.service.agentInstance.sendMsgToAgent(conversationId, {
        text: content,
        ...(attachment ? { attachment: attachment.reference } : {}),
        ...(wikiTiddlers ? { wikiTiddlers } : {}),
      });
      throwIfAborted(options?.signal);
    },
    subscribeToMessages(conversationId, listener) {
      const unsubscribe = updateSource.subscribe(conversationId, listener);
      const mutationSubscription = window.observables.agentInstance.subscribeConversationMutations().subscribe({
        next: wake => {
          for (const changedConversationId of wake.conversationIds) {
            updateSource.wake(changedConversationId);
          }
        },
        error: (error: unknown) => {
          void window.service.native.log('warn', 'Conversation mutation wake stream failed; bounded polling remains active', {
            conversationId,
            error,
          });
        },
      });
      return () => {
        mutationSubscription.unsubscribe();
        unsubscribe();
      };
    },
    async deleteTurn(request, options) {
      throwIfAborted(options?.signal);
      const response = await window.service.agentInstance.deleteAgentTurn(request);
      throwIfAborted(options?.signal);
      return response;
    },
    async retryTurn(request, options) {
      throwIfAborted(options?.signal);
      const response = await window.service.agentInstance.retryAgentTurn(request);
      throwIfAborted(options?.signal);
      return response;
    },
  };
}

export function createDesktopAgentSessionController(): AgentSessionController {
  return new AgentSessionController({
    agentInstanceClient: createAgentInstanceClient(),
    conversationClient: createDesktopConversationClient(),
    maxResidentMessages: DESKTOP_SESSION_MESSAGE_LIMIT,
    maxResidentBytes: DESKTOP_SESSION_BYTE_LIMIT,
  });
}

export function createDesktopTimelineController(): ConversationTimelineWindowController {
  return new ConversationTimelineWindowController({
    async getPage(request, options) {
      options.signal.throwIfAborted();
      const page = await window.service.agentInstance.getAgentConversationTimelinePage(request);
      options.signal.throwIfAborted();
      return page;
    },
  });
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** One cancellable persisted range only; UI continuation explicitly requests the next range. */
export const loadDesktopMessageDetail: MemeLoopMessageDetailLoader = async (message, request) => {
  request.signal.throwIfAborted();
  const offset = request.cursor === undefined
    ? 0
    : /^\d{1,8}$/u.test(request.cursor)
    ? Number(request.cursor)
    : Number.NaN;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('invalid_message_detail_cursor');
  const response = await window.service.agentInstance.getAgentConversationMessageDetail({
    conversationId: message.conversationId,
    messageId: message.messageId,
    ...(offset === 0 ? {} : { offset }),
  });
  request.signal.throwIfAborted();
  if (!response.found) return null;
  const bytes = base64ToBytes(response.data);
  // Leave room for the validated page envelope while preserving a strict
  // single-range memory ceiling. Complete bytes remain available to export.
  const displayBytes = bytes.subarray(0, Math.min(bytes.byteLength, 252 * 1024));
  const text = new TextDecoder('utf-8').decode(displayBytes);
  return validateMessageDetailPage({
    text,
    itemCount: 1,
    truncated: response.nextOffset !== undefined || displayBytes.byteLength < bytes.byteLength,
    ...(response.nextOffset === undefined ? {} : { nextCursor: String(response.nextOffset) }),
  }, request.maxBytes);
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return btoa(binary);
}

function digestHex(bytes: Uint8Array): string {
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

/** Upload a Web File in bounded chunks before the session send commits its reference. */
export async function mapDesktopFile(
  file: File,
  context: { conversationId: string; signal: AbortSignal },
) {
  const upload = createAttachmentUploadRpcClient({
    call: async (method, request) => {
      context.signal.throwIfAborted();
      if (method === 'memeloop.chat.beginAttachmentUpload') {
        return window.service.agentInstance.beginAgentAttachmentUpload(request as BeginAttachmentUploadRequest);
      }
      if (method === 'memeloop.chat.uploadAttachmentChunk') {
        return window.service.agentInstance.uploadAgentAttachmentChunk(request as UploadAttachmentChunkRequest);
      }
      return window.service.agentInstance.commitAgentAttachmentUpload(request as CommitAttachmentUploadRequest);
    },
  });
  const operationId = nanoid();
  const begin = await upload.begin({
    conversationId: context.conversationId,
    requestId: `${operationId}:begin`,
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    totalBytes: file.size,
  }, { signal: context.signal });
  const hasher = new Sha256();
  const maximumChunkBytes = Math.min(256 * 1024, begin.maxChunkBytes);
  for (let offset = 0; offset < file.size; offset += maximumChunkBytes) {
    context.signal.throwIfAborted();
    const bytes = new Uint8Array(await file.slice(offset, offset + maximumChunkBytes).arrayBuffer());
    context.signal.throwIfAborted();
    hasher.update(bytes);
    await upload.chunk({
      conversationId: context.conversationId,
      requestId: `${operationId}:chunk:${offset}`,
      uploadId: begin.uploadId,
      offset,
      byteLength: bytes.byteLength,
      encoding: 'base64',
      data: bytesToBase64(bytes),
    }, { signal: context.signal });
  }
  const sha256 = `sha256:${digestHex(await hasher.digest())}`;
  const committed = await upload.commit({
    conversationId: context.conversationId,
    requestId: `${operationId}:commit`,
    uploadId: begin.uploadId,
    size: file.size,
    sha256,
  }, { signal: context.signal });
  return { kind: 'committed' as const, reference: committed.attachment };
}
