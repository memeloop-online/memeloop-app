/** @vitest-environment node */
import { afterEach, describe, expect, it } from 'vitest';

import { type ChatMessage, type ConversationEvent, messageToConversationEvent } from 'memeloop';
import { type ConversationMutationWake, installConversationMutationObserver } from '../conversationMutationObserver';

interface TestSQLiteStorage {
  close(): void;
  appendLocalEvent(draft: unknown): Promise<unknown>;
  insertEventsIfAbsent(events: readonly ConversationEvent[]): Promise<unknown>;
  upsertConversationMetadata(meta: Record<string, unknown>): Promise<unknown>;
  getConversationTimelinePage(
    conversationId: string,
    options: { limit: number; maxBytes: number },
  ): Promise<{ revision: string }>;
  listConversationsPage(options: { limit: number; maxBytes: number }): Promise<{ revision: string }>;
}

type SQLiteStorageConstructor = new() => TestSQLiteStorage;
const openStores: TestSQLiteStorage[] = [];

function getConstructor(value: unknown): SQLiteStorageConstructor | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = (value as { SQLiteAgentStorage?: unknown }).SQLiteAgentStorage;
  if (typeof candidate !== 'function') return undefined;
  const prototype = (candidate as {
    prototype?: { insertEventsIfAbsent?: unknown; getConversationTimelinePage?: unknown };
  }).prototype;
  return typeof prototype?.insertEventsIfAbsent === 'function' &&
      typeof prototype.getConversationTimelinePage === 'function'
    ? candidate as SQLiteStorageConstructor
    : undefined;
}

async function createStorage(): Promise<TestSQLiteStorage> {
  const installed = getConstructor(await import('memeloop-cli'));
  if (installed) {
    const storage = new installed();
    openStores.push(storage);
    return storage;
  }
  const sourceUrl = new URL(
    '../../../../../../../memeloop/packages/memeloop-cli/src/storage/sqliteStorage.ts',
    import.meta.url,
  );
  const source = getConstructor(await import(/* @vite-ignore */ sourceUrl.href));
  if (!source) throw new Error('MemeLoop CLI SQLite storage is unavailable');
  const storage = new source();
  openStores.push(storage);
  return storage;
}

function event(conversationId: string, messageId: string, originSequence: number): ConversationEvent {
  const message: ChatMessage = {
    messageId,
    turnId: messageId,
    conversationId,
    originNodeId: 'observer-test-node',
    originSequence,
    lamportClock: originSequence,
    timestamp: originSequence,
    role: 'user',
    parts: [{ type: 'text', text: messageId }],
    content: messageId,
  };
  return messageToConversationEvent(message);
}

async function seed(storage: TestSQLiteStorage, conversationId: string): Promise<void> {
  await storage.upsertConversationMetadata({
    conversationId,
    title: 'observer test',
    lastMessagePreview: '',
    lastMessageTimestamp: 0,
    messageCount: 0,
    originNodeId: 'observer-test-node',
    originClock: 0,
    definitionId: 'general-assistant',
    isUserInitiated: true,
  });
}

afterEach(() => {
  for (const storage of openStores.splice(0)) storage.close();
});

describe('UtilityProcess SQLite conversation mutation wakes', () => {
  it('wakes for external sync without relying on agent status updates', async () => {
    const storage = await createStorage();
    await seed(storage, 'sync-conversation');
    const wakes: ConversationMutationWake[] = [];
    const dispose = installConversationMutationObserver(storage, wake => wakes.push(wake));

    await storage.insertEventsIfAbsent([event('sync-conversation', 'message-1', 1)]);

    expect(wakes).toEqual([{
      conversationIds: ['sync-conversation'],
      hint: 'append',
    }]);
    dispose();
    await storage.insertEventsIfAbsent([event('sync-conversation', 'message-2', 2)]);
    expect(wakes).toHaveLength(1);
  });

  it('does not wake for duplicate or failed transactions', async () => {
    const storage = await createStorage();
    await seed(storage, 'duplicate-conversation');
    const wakes: ConversationMutationWake[] = [];
    const dispose = installConversationMutationObserver(storage, wake => wakes.push(wake));
    const first = event('duplicate-conversation', 'message-1', 1);

    await storage.insertEventsIfAbsent([first]);
    wakes.length = 0;
    await storage.insertEventsIfAbsent([first]);
    expect(wakes).toEqual([]);

    await expect(storage.insertEventsIfAbsent([{
      ...first,
      eventId: 'invalid-event',
      originSequence: 2,
      // The canonical validator rejects this malformed event before SQLite
      // can commit anything, which exercises the failed/rollback path.
      conversationId: '',
    }])).rejects.toThrow();
    expect(wakes).toEqual([]);
    dispose();
  });

  it('coalesces a mixed message+tombstone batch into one reset wake', async () => {
    const storage = await createStorage();
    await seed(storage, 'mixed-conversation');
    const wakes: ConversationMutationWake[] = [];
    const dispose = installConversationMutationObserver(storage, wake => wakes.push(wake));
    const message = event('mixed-conversation', 'message-1', 1);
    await storage.insertEventsIfAbsent([message]);
    wakes.length = 0;

    await storage.insertEventsIfAbsent([{
      ...event('mixed-conversation', 'message-2', 2),
    }, {
      eventId: 'tombstone-1',
      conversationId: 'mixed-conversation',
      originNodeId: 'observer-test-node',
      originSequence: 3,
      lamportClock: 3,
      timestamp: 3,
      kind: 'tombstone',
      targetTurnId: 'message-1',
      reason: 'user-delete',
    }]);

    expect(wakes).toEqual([{
      conversationIds: ['mixed-conversation'],
      hint: 'reset',
    }]);
    dispose();
  });
});
