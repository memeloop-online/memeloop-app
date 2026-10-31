/** @vitest-environment node */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import {
  type AgentRunRecord,
  type AtomicAgentRetryInput,
  type AtomicAgentRetryStore,
  type ChatMessage,
  type ConversationEvent,
  domainSeparatedCanonicalJsonBytes,
  isAtomicAgentRetryStore,
  messageToConversationEvent,
} from 'memeloop';

interface TestSQLiteStorage extends AtomicAgentRetryStore {
  close(): void;
  getConversationEventPage(
    conversationId: string,
    options: { limit: number; direction: 'forward' },
  ): Promise<{ items: ConversationEvent[] }>;
  getMessageById(conversationId: string, messageId: string): Promise<ChatMessage | null>;
  insertEventsIfAbsent(events: readonly ConversationEvent[]): Promise<unknown>;
  upsertConversationMetadata(meta: {
    conversationId: string;
    title: string;
    lastMessagePreview: string;
    lastMessageTimestamp: number;
    messageCount: number;
    originNodeId: string;
    originClock: number;
    definitionId: string;
    isUserInitiated: boolean;
  }): Promise<unknown>;
}

type SQLiteStorageConstructor = new() => TestSQLiteStorage;

const openStores: TestSQLiteStorage[] = [];

function sqliteStorageConstructor(value: unknown): SQLiteStorageConstructor | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = (value as { SQLiteAgentStorage?: unknown }).SQLiteAgentStorage;
  if (typeof candidate !== 'function') return undefined;
  const prototype = (candidate as { prototype?: { retryTurnAtomic?: unknown } }).prototype;
  return typeof prototype?.retryTurnAtomic === 'function'
    ? candidate as SQLiteStorageConstructor
    : undefined;
}

async function loadSQLiteStorageConstructor(): Promise<SQLiteStorageConstructor> {
  const installedModule: unknown = await import('memeloop-cli');
  const installed = sqliteStorageConstructor(installedModule);
  if (installed) return installed;

  // Coordinated source workspaces exercise the final CLI implementation before
  // its tarball is installed. A release/CI checkout must provide the public
  // package capability and will never reach this optional sibling fallback.
  const sourceUrl = new URL(
    '../../../../../../../memeloop/packages/memeloop-cli/src/storage/sqliteStorage.ts',
    import.meta.url,
  );
  let sourceModule: unknown;
  try {
    sourceModule = await import(/* @vite-ignore */ sourceUrl.href);
  } catch {
    throw new Error('Installed memeloop-cli lacks AtomicAgentRetryStore');
  }
  const source = sqliteStorageConstructor(sourceModule);
  if (!source) throw new Error('MemeLoop CLI SQLite atomic retry capability is unavailable');
  return source;
}

async function createStorage(): Promise<TestSQLiteStorage> {
  const SQLiteAgentStorage = await loadSQLiteStorageConstructor();
  const storage = new SQLiteAgentStorage();
  const capability: unknown = storage;
  if (!isAtomicAgentRetryStore(capability)) {
    storage.close();
    throw new Error('MemeLoop CLI SQLite atomic retry capability is unavailable');
  }
  openStores.push(storage);
  return storage;
}

function replacementPayload(source: ChatMessage, turnId: string) {
  return {
    messageId: turnId,
    turnId,
    role: 'user' as const,
    content: source.content,
    parts: source.parts,
    ...(source.attachments === undefined ? {} : { attachments: source.attachments }),
    ...(source.metadata === undefined ? {} : { metadata: source.metadata }),
  };
}

function retryFixture(source: ChatMessage): AtomicAgentRetryInput & { mode: 'fresh' } {
  const replacement = replacementPayload(source, 'turn-new');
  const digestInput = {
    operation: 'retry-turn-v2',
    conversationId: source.conversationId,
    definitionId: 'definition-1',
    sourceTurnId: source.turnId,
    newTurnId: replacement.turnId,
    userMessage: replacement,
  };
  const candidateRun: AgentRunRecord = {
    runId: 'run-retry-1',
    conversationId: source.conversationId,
    definitionId: 'definition-1',
    turnId: replacement.turnId,
    requestPeerId: 'authenticated-desktop-peer',
    requestId: 'retry-request-1',
    payloadDigest: createHash('sha256')
      .update(domainSeparatedCanonicalJsonBytes('memeloop-run-payload-v1', digestInput))
      .digest('hex'),
    retrySourceTurnId: source.turnId,
    state: 'accepted',
    acceptedAt: 10,
    updatedAt: 10,
  };
  return {
    mode: 'fresh',
    candidateRun,
    sourceTurnId: source.turnId,
    expectedSourceMessage: source,
    replacementPayload: replacement,
    originNodeId: 'desktop-local-node',
  };
}

async function seedSource(storage: TestSQLiteStorage): Promise<ChatMessage> {
  const source: ChatMessage = {
    messageId: 'turn-old',
    turnId: 'turn-old',
    conversationId: 'conversation-atomic-retry',
    originNodeId: 'source-node',
    originSequence: 1,
    lamportClock: 1,
    timestamp: 1,
    role: 'user',
    parts: [{ type: 'text', text: 'durable source content' }],
    content: 'durable source content',
    metadata: { retained: true },
  };
  await storage.upsertConversationMetadata({
    conversationId: source.conversationId,
    title: 'Atomic retry',
    lastMessagePreview: '',
    lastMessageTimestamp: 0,
    messageCount: 0,
    originNodeId: source.originNodeId,
    originClock: 0,
    definitionId: 'definition-1',
    isUserInitiated: true,
  });
  await storage.insertEventsIfAbsent([messageToConversationEvent(source)]);
  return source;
}

afterEach(() => {
  for (const storage of openStores.splice(0)) storage.close();
});

describe('Desktop UtilityProcess SQLite atomic retry integration', () => {
  it('coalesces concurrent calls and exact replay to one run and event pair', async () => {
    const storage = await createStorage();
    const input = retryFixture(await seedSource(storage));

    const results = await Promise.all(
      Array.from({ length: 12 }, async () => storage.retryTurnAtomic(input)),
    );

    expect(results.filter(result => result.created)).toHaveLength(1);
    expect(new Set(results.map(result => result.run.runId))).toEqual(new Set(['run-retry-1']));
    expect(new Set(results.map(result => result.tombstone.eventId))).toEqual(
      new Set(['tombstone:retry:run-retry-1']),
    );
    expect(new Set(results.map(result => result.userEvent.eventId))).toEqual(new Set(['turn-new']));

    const { expectedSourceMessage: _expectedSourceMessage, ...replayBase } = input;
    const replay = await storage.retryTurnAtomic({ ...replayBase, mode: 'replay' });
    expect(replay).toMatchObject({
      created: false,
      run: { runId: 'run-retry-1' },
      tombstone: { eventId: 'tombstone:retry:run-retry-1' },
      userEvent: { eventId: 'turn-new', message: { content: 'durable source content' } },
    });
  });

  it('rolls back the run, tombstone, and replacement when projection persistence fails', async () => {
    const storage = await createStorage();
    const source = await seedSource(storage);
    const input = retryFixture(source);
    const database = (storage as unknown as { database?: { exec(sql: string): unknown }; db?: { exec(sql: string): unknown } }).database ??
      (storage as unknown as { db: { exec(sql: string): unknown } }).db;
    database.exec(`
      CREATE TRIGGER desktop_force_retry_rollback
      BEFORE INSERT ON messages
      WHEN NEW.messageId = 'turn-new'
      BEGIN
        SELECT RAISE(ABORT, 'forced retry projection failure');
      END
    `);

    await expect(storage.retryTurnAtomic(input)).rejects.toThrow('forced retry projection failure');
    expect(await storage.getByRequest('authenticated-desktop-peer', 'retry-request-1')).toBeUndefined();
    expect(await storage.getMessageById(source.conversationId, 'turn-new')).toBeNull();
    expect(await storage.getMessageById(source.conversationId, source.messageId)).toEqual(source);
    const events = await storage.getConversationEventPage(source.conversationId, {
      limit: 16,
      direction: 'forward',
    });
    expect(events.items.map(event => event.eventId)).toEqual([source.messageId]);

    database.exec('DROP TRIGGER desktop_force_retry_rollback');
    await expect(storage.retryTurnAtomic(input)).resolves.toMatchObject({ created: true });
  });
});
