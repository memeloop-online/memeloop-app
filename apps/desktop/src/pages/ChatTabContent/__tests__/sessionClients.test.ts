import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDesktopConversationClient, DESKTOP_SESSION_BYTE_LIMIT, DESKTOP_SESSION_MESSAGE_LIMIT, mapDesktopFile } from '../sessionClients';

const conversationId = 'conversation-100k';

function message(index: number) {
  return {
    messageId: `message-${index}`,
    turnId: `turn-${Math.floor(index / 2)}`,
    conversationId,
    originNodeId: 'persisted-node',
    originSequence: index + 1,
    timestamp: index + 1,
    lamportClock: index + 1,
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `message ${index}`,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

describe('desktop long-chat conversation bridge', () => {
  const service = window.service as unknown as Record<string, unknown>;
  const observables = window.observables as unknown as Record<string, unknown>;
  let previousService: unknown;
  let previousObservables: unknown;
  let agentUpdates: Subject<unknown>;
  let mutations: Subject<{
    conversationIds: string[];
    hint: 'append' | 'tombstone' | 'compaction' | 'reset';
  }>;
  let revision: string;
  let totalMessages: number;
  let timelineCalls: ReturnType<typeof vi.fn>;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    previousService = service.agentInstance;
    previousObservables = observables.agentInstance;
    agentUpdates = new Subject();
    mutations = new Subject();
    revision = 'revision-1';
    totalMessages = 2_000_000;
    timelineCalls = vi.fn(async () => ({
      reset: false,
      items: [],
      revision,
      totalMessages,
      totalTurns: 1_000_000,
      totalEntries: 1_000_004,
      hasMoreBefore: true,
      hasMoreAfter: false,
    }));
    send = vi.fn().mockResolvedValue(undefined);
    service.agentInstance = {
      getAgentConversationMessagePage: vi.fn(async (_id, options) => ({
        reset: false,
        conversationId,
        revision,
        items: Array.from({ length: options.limit }, (_, offset) => message(totalMessages - options.limit + offset)),
        hasMoreBefore: true,
        hasMoreAfter: false,
      })),
      getAgentConversationMessageWindow: vi.fn(async request => ({
        reset: false,
        conversationId,
        revision,
        focus: request.focus,
        items: Array.from({ length: request.maxMessages }, (_, index) => message(999_950 + index)),
        hasMoreBefore: true,
        hasMoreAfter: true,
      })),
      getAgentConversationTimelinePage: timelineCalls,
      getAgentConversationTurnDetail: vi.fn(),
      sendMsgToAgent: send,
      deleteAgentTurn: vi.fn().mockResolvedValue({ requestId: 'delete-1', conversationId, turnId: 'turn-1' }),
      retryAgentTurn: vi.fn().mockResolvedValue({ requestId: 'retry-1', conversationId, oldTurnId: 'turn-1', newTurnId: 'turn-new' }),
      beginAgentAttachmentUpload: vi.fn(async request => ({
        ok: true,
        conversationId,
        requestId: request.requestId,
        uploadId: 'upload-1',
        totalBytes: request.totalBytes,
        maxChunkBytes: 3 * 1024 * 1024,
      })),
      uploadAgentAttachmentChunk: vi.fn(async request => ({
        ok: true,
        conversationId,
        requestId: request.requestId,
        uploadId: request.uploadId,
        offset: request.offset,
        byteLength: request.byteLength,
      })),
      commitAgentAttachmentUpload: vi.fn(async request => ({
        ok: true,
        conversationId,
        requestId: request.requestId,
        uploadId: request.uploadId,
        attachment: {
          contentHash: request.sha256,
          filename: 'unicode-📄.txt',
          mimeType: 'text/plain',
          size: request.size,
        },
      })),
    };
    observables.agentInstance = {
      subscribeToAgentUpdates: () => agentUpdates,
      subscribeConversationMutations: () => mutations,
    };
  });

  afterEach(() => {
    agentUpdates.complete();
    mutations.complete();
    service.agentInstance = previousService;
    observables.agentInstance = previousObservables;
    vi.restoreAllMocks();
  });

  it('opens and randomly seeks a virtual one-million-turn, repeatedly compacted conversation with one bounded page/window', async () => {
    const client = createDesktopConversationClient();
    const page = await client.getMessagePage(conversationId, {
      limit: DESKTOP_SESSION_MESSAGE_LIMIT,
      maxBytes: DESKTOP_SESSION_BYTE_LIMIT,
    });
    expect(page.reset).toBe(false);
    if (page.reset) return;
    expect(page.items).toHaveLength(50);
    const around = await client.getMessageWindowAround({
      conversationId,
      focus: {
        kind: 'message',
        messageId: 'message-1000000',
        turnId: 'turn-500000',
        cursor: 'cursor-500000',
      },
      expectedRevision: revision,
      maxMessages: DESKTOP_SESSION_MESSAGE_LIMIT,
      maxBytes: DESKTOP_SESSION_BYTE_LIMIT,
    });
    expect(around.reset).toBe(false);
    if (!around.reset) expect(around.items).toHaveLength(50);
    expect((service.agentInstance as { getAgentConversationMessagePage: ReturnType<typeof vi.fn> }).getAgentConversationMessagePage).toHaveBeenCalledOnce();
    expect((service.agentInstance as { getAgentConversationMessageWindow: ReturnType<typeof vi.fn> }).getAgentConversationMessageWindow).toHaveBeenCalledOnce();
  });

  it('starts its revision baseline before the initial bounded message page request', async () => {
    const order: string[] = [];
    timelineCalls.mockImplementation(async () => {
      order.push('head');
      return {
        reset: false,
        items: [],
        revision,
        totalMessages,
        totalTurns: 1_000_000,
        totalEntries: 1_000_004,
        hasMoreBefore: true,
        hasMoreAfter: false,
      };
    });
    const messagePage = (service.agentInstance as {
      getAgentConversationMessagePage: ReturnType<typeof vi.fn>;
    }).getAgentConversationMessagePage;
    messagePage.mockImplementation(async (_id, options) => {
      order.push('page');
      return {
        reset: false,
        conversationId,
        revision,
        items: Array.from({ length: options.limit }, (_, offset) => message(totalMessages - options.limit + offset)),
        hasMoreBefore: true,
        hasMoreAfter: false,
      };
    });

    const client = createDesktopConversationClient();
    const unsubscribe = client.subscribeToMessages(conversationId, () => undefined);
    await client.getMessagePage(conversationId, {
      limit: DESKTOP_SESSION_MESSAGE_LIMIT,
      maxBytes: DESKTOP_SESSION_BYTE_LIMIT,
    });

    expect(order.slice(0, 2)).toEqual(['head', 'page']);
    unsubscribe();
  });

  it('uses the shared bounded polling source and derives an exact append delta from a content-free worker wake', async () => {
    const client = createDesktopConversationClient();
    const seen: unknown[] = [];
    const unsubscribe = client.subscribeToMessages(conversationId, update => {
      seen.push(update);
    });
    await flush();
    expect(timelineCalls).toHaveBeenCalledOnce();

    revision = 'revision-2';
    totalMessages += 2;
    mutations.next({ conversationIds: [conversationId], hint: 'append' });
    await flush();

    expect(timelineCalls).toHaveBeenCalledTimes(2);
    expect(seen).toContainEqual(expect.objectContaining({
      reason: 'append',
      previousRevision: 'revision-1',
      revision: 'revision-2',
      appendedMessageCount: 2,
    }));
    unsubscribe();
  });

  it('coalesces wake bursts, ignores unrelated conversations and never reloads message history to detect change', async () => {
    const client = createDesktopConversationClient();
    const seen: unknown[] = [];
    const unsubscribe = client.subscribeToMessages(conversationId, update => {
      seen.push(update);
    });
    await flush();
    const messagePage = (service.agentInstance as {
      getAgentConversationMessagePage: ReturnType<typeof vi.fn>;
    }).getAgentConversationMessagePage;

    mutations.next({ conversationIds: ['another-conversation'], hint: 'append' });
    for (let index = 0; index < 100; index += 1) {
      mutations.next({ conversationIds: [conversationId], hint: 'append' });
    }
    revision = 'revision-2';
    totalMessages += 2;
    await flush();

    expect(timelineCalls).toHaveBeenCalledTimes(2);
    expect(messagePage).not.toHaveBeenCalled();
    expect(seen.filter(update => (update as { reason?: string }).reason === 'append')).toHaveLength(1);
    expect(seen).toContainEqual(expect.objectContaining({ appendedMessageCount: 2 }));
    unsubscribe();
  });

  it('projects a destructive mutation as reset, then observes the next append from the new baseline', async () => {
    const client = createDesktopConversationClient();
    const seen: unknown[] = [];
    const unsubscribe = client.subscribeToMessages(conversationId, update => {
      seen.push(update);
    });
    await flush();

    revision = 'revision-2';
    totalMessages -= 2;
    await client.deleteTurn({ conversationId, turnId: 'turn-1', requestId: 'delete-1' });
    mutations.next({ conversationIds: [conversationId], hint: 'tombstone' });
    await flush();

    revision = 'revision-3';
    totalMessages += 2;
    mutations.next({ conversationIds: [conversationId], hint: 'append' });
    await flush();

    expect(seen).toContainEqual(expect.objectContaining({ reason: 'reset', revision: 'revision-2' }));
    expect(seen).toContainEqual(expect.objectContaining({ reason: 'append', revision: 'revision-3', appendedMessageCount: 2 }));
    unsubscribe();
  });

  it('retries by durable turn identity without renderer-supplied content', async () => {
    const client = createDesktopConversationClient();
    await client.retryTurn({
      conversationId,
      turnId: 'turn-old',
      newTurnId: 'turn-new',
      requestId: 'retry-request',
    });
    const retry = (service.agentInstance as {
      retryAgentTurn: ReturnType<typeof vi.fn>;
    }).retryAgentTurn;
    expect(retry).toHaveBeenCalledWith({
      conversationId,
      turnId: 'turn-old',
      newTurnId: 'turn-new',
      requestId: 'retry-request',
    });
    expect(retry.mock.calls[0]?.[0]).not.toHaveProperty('message');
  });

  it('uploads a UTF-8 named max-chunk+1 attachment without full-file materialization', async () => {
    const bytes = new Uint8Array(256 * 1024 + 1).fill(0xe4);
    const file = new File([bytes], 'unicode-📄.txt', { type: 'text/plain' });
    const attachment = await mapDesktopFile(file, {
      conversationId,
      signal: new AbortController().signal,
    });
    const uploadChunk = (service.agentInstance as {
      uploadAgentAttachmentChunk: { mock: { calls: Array<[{ byteLength: number }]> } };
    }).uploadAgentAttachmentChunk;
    expect(uploadChunk.mock.calls.map(call => call[0].byteLength)).toEqual([256 * 1024, 1]);
    expect(attachment).toMatchObject({
      kind: 'committed',
      reference: { filename: 'unicode-📄.txt', size: 256 * 1024 + 1 },
    });
    expect(attachment.reference.contentHash).toMatch(/^sha256:[\da-f]{64}$/u);
  });
});
