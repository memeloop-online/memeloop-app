/** @vitest-environment node */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  canonicalJsonBytes,
  type ConversationEvent,
  type ConversationMessageCursor,
  type ConversationMessagePage,
  type ConversationMessageWindowResult,
  type ConversationTimelinePage,
} from 'memeloop';
import { createDesktopAgentRuntimeProjectionStore } from '../sqliteAgentRuntimeProjectionStore';

const CONVERSATION_ID = 'desktop-performance-100k';
const MESSAGE_COUNT = 100_000;
const PAGE_LIMIT = 50;
const PAGE_BYTES = 256 * 1024;
const READ_BUDGET_MS = 1_000;
// CI workers can exhibit material startup/IO jitter during the single
// transaction that ingests 100k events. Keep this bounded at 45s while the
// read/seek budgets and SQL-count assertions below remain strict.
const POSIX_SEED_BUDGET_MS = 45_000;
// sansheng Windows acceptance measured 41.754s for the same single-transaction
// 100k ingest. 50s preserves a bounded regression gate with ~20% platform
// headroom without weakening the independently strict read/seek budgets.
const WINDOWS_SEED_BUDGET_MS = 50_000;

interface SQLiteStatement {
  all(...parameters: unknown[]): unknown[];
  get(...parameters: unknown[]): unknown;
  run(...parameters: unknown[]): unknown;
}

interface SQLiteDatabase {
  prepare(source: string): SQLiteStatement;
  transaction<T>(operation: () => T): () => T;
}

interface TestSQLiteStorage {
  close(): void;
  db: SQLiteDatabase;
  getConversationTimelinePage(
    conversationId: string,
    options: {
      limit: number;
      maxBytes: number;
      previewLength?: number;
      beforeCursor?: string;
      afterCursor?: string;
      aroundEntryIndex?: number;
      expectedRevision?: string;
    },
    callOptions?: { signal?: AbortSignal },
  ): Promise<ConversationTimelinePage>;
  getMessagePage(
    conversationId: string,
    options: {
      limit: number;
      maxBytes: number;
      before?: ConversationMessageCursor;
      expectedRevision?: string;
    },
  ): Promise<ConversationMessagePage>;
  getMessageWindowAround(
    conversationId: string,
    options: {
      focus:
        | { kind: 'message'; messageId: string; turnId: string; cursor?: string }
        | { kind: 'timeline-entry'; entryId: string; cursor: string };
      expectedRevision: string;
      maxMessages: number;
      maxBytes: number;
    },
  ): Promise<ConversationMessageWindowResult>;
  insertEventsIfAbsent(events: readonly ConversationEvent[]): Promise<void>;
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
  }): Promise<void>;
}

type SQLiteStorageConstructor = new(options?: { filename?: string }) => TestSQLiteStorage;

interface Timings {
  seedMs: number;
  coldTailMs: number;
  hotTailMs: number;
  coldTimelineMs: number;
  hotTimelineMs: number;
  randomWindow50kMs: number;
  repeatedCompactionSeekMs: number;
}

interface SeedProjectionCounts {
  events: number;
  messages: number;
  timelineEntries: number;
  contiguousFrontier: number;
}

interface SqlCounts {
  coldTail: number;
  hotTail: number;
  olderTail: number;
  coldTimeline: number;
  hotTimeline: number;
  olderTimeline: number;
  middleTimeline: number;
  randomWindow50k: number;
  turnDetail: number;
  compactionWindow: number;
  repeatedCompactionSeek: number;
}

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

  // The coordinated source workspace exercises the frozen CLI before the
  // final registry tarball is installed. Standalone CI must provide the public
  // package capability and therefore will not need this sibling fallback.
  const sourceUrl = new URL(
    '../../../../../../../memeloop/packages/memeloop-cli/src/storage/sqliteStorage.ts',
    import.meta.url,
  );
  let sourceModule: unknown;
  try {
    sourceModule = await import(/* @vite-ignore */ sourceUrl.href);
  } catch {
    throw new Error('Installed memeloop-cli lacks the final SQLite v2 storage');
  }
  const source = sqliteStorageConstructor(sourceModule);
  if (!source) throw new Error('MemeLoop CLI SQLite v2 storage is unavailable');
  return source;
}

function messageEvent(index: number): ConversationEvent {
  const sequence = index + 1;
  const messageId = `message-${sequence.toString().padStart(6, '0')}`;
  return {
    eventId: messageId,
    conversationId: CONVERSATION_ID,
    originNodeId: 'desktop-performance-origin',
    originSequence: sequence,
    lamportClock: sequence,
    timestamp: sequence,
    kind: 'message',
    message: {
      messageId,
      turnId: messageId,
      role: 'user',
      parts: [{ type: 'text', text: `desktop long conversation message ${sequence}` }],
      content: `desktop long conversation message ${sequence}`,
    },
  };
}

function responseBytes(value: unknown): number {
  return canonicalJsonBytes(value, {
    maxBytes: PAGE_BYTES,
    maxStringBytes: PAGE_BYTES,
    maxStringCodeUnits: PAGE_BYTES,
  }).byteLength;
}

async function measured<T>(operation: () => Promise<T>): Promise<{ value: T; elapsedMs: number }> {
  const startedAt = performance.now();
  const value = await operation();
  return { value, elapsedMs: performance.now() - startedAt };
}

function seedBudgetMs(platform: NodeJS.Platform): number {
  return platform === 'win32' ? WINDOWS_SEED_BUDGET_MS : POSIX_SEED_BUDGET_MS;
}

function attachTransactionCounter(storage: TestSQLiteStorage) {
  const database = storage.db;
  let transactions = 0;
  storage.db = new Proxy(database, {
    get(target, property) {
      if (property === 'transaction') {
        return (operation: () => unknown): () => unknown => {
          transactions += 1;
          return target.transaction(operation);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== 'function') return value;
      return (...parameters: unknown[]): unknown => (value as (...arguments_: unknown[]) => unknown).apply(target, parameters);
    },
  });
  return { count: () => transactions };
}

function planDetails(
  database: SQLiteDatabase,
  sql: string,
  parameters: readonly unknown[],
): string {
  return (database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters) as Array<{ detail: string }>)
    .map(row => row.detail)
    .join('\n');
}

function createCountedDesktopProjection(storage: TestSQLiteStorage) {
  let prepareCalls = 0;
  let timelineCalls = 0;
  const countedDatabase: SQLiteDatabase = {
    prepare(source) {
      prepareCalls += 1;
      return storage.db.prepare(source);
    },
    transaction(operation) {
      return storage.db.transaction(operation);
    },
  };
  const projection = createDesktopAgentRuntimeProjectionStore({
    db: countedDatabase,
    getConversationTimelinePage: async (...parameters: Parameters<TestSQLiteStorage['getConversationTimelinePage']>) => {
      timelineCalls += 1;
      return storage.getConversationTimelinePage(...parameters);
    },
  } as never);
  return {
    projection,
    counts: () => ({ prepareCalls, timelineCalls }),
    resetCounts: () => {
      prepareCalls = 0;
      timelineCalls = 0;
    },
  };
}

function attachSqlExecutionCounter(storage: TestSQLiteStorage) {
  const database = storage.db;
  let executions = 0;
  storage.db = new Proxy(database, {
    get(target, property) {
      if (property === 'prepare') {
        return (source: string): SQLiteStatement => {
          const statement = target.prepare(source);
          return new Proxy(statement, {
            get(statementTarget, statementProperty) {
              const value = Reflect.get(statementTarget, statementProperty, statementTarget) as unknown;
              if (
                (statementProperty === 'all' || statementProperty === 'get' || statementProperty === 'run') &&
                typeof value === 'function'
              ) {
                return (...parameters: unknown[]): unknown => {
                  executions += 1;
                  return (value as (...arguments_: unknown[]) => unknown).apply(statementTarget, parameters);
                };
              }
              if (typeof value !== 'function') return value;
              return (...parameters: unknown[]): unknown =>
                (value as (...arguments_: unknown[]) => unknown)
                  .apply(statementTarget, parameters);
            },
          });
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== 'function') return value;
      return (...parameters: unknown[]): unknown =>
        (value as (...arguments_: unknown[]) => unknown)
          .apply(target, parameters);
    },
  });
  return {
    count: () => executions,
    reset: () => {
      executions = 0;
    },
  };
}

describe('Desktop real SQLite 100k long-conversation performance', () => {
  it('keeps paging, timeline, random seek, and repeated compaction indexed and bounded', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'desktop-long-chat-'));
    const filename = join(directory, 'memeloop.db');
    const SQLiteAgentStorage = await loadSQLiteStorageConstructor();
    let storage: TestSQLiteStorage | undefined;
    const timings = {} as Timings;
    const sqlCounts = {} as SqlCounts;
    try {
      storage = new SQLiteAgentStorage({ filename });
      await storage.upsertConversationMetadata({
        conversationId: CONVERSATION_ID,
        title: 'Desktop 100k integration',
        lastMessagePreview: '',
        lastMessageTimestamp: 0,
        messageCount: 0,
        originNodeId: 'desktop-performance-origin',
        originClock: 0,
        definitionId: 'definition-performance',
        isUserInitiated: true,
      });
      const events = Array.from({ length: MESSAGE_COUNT }, (_, index) => messageEvent(index));
      const seedTransactions = attachTransactionCounter(storage);
      const seeded = await measured(() => storage!.insertEventsIfAbsent(events));
      timings.seedMs = seeded.elapsedMs;
      expect(seedTransactions.count()).toBe(1);
      const seedProjectionCounts = storage.db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM conversation_events WHERE conversationId = ?) AS events,
          (SELECT COUNT(*) FROM messages WHERE conversationId = ?) AS messages,
          (SELECT COUNT(*) FROM conversation_timeline_entries_v2 WHERE conversationId = ?)
            AS timelineEntries,
          (SELECT contiguousFrontier FROM conversation_event_sequences
            WHERE conversationId = ? AND originNodeId = ?) AS contiguousFrontier
      `).get(
        CONVERSATION_ID,
        CONVERSATION_ID,
        CONVERSATION_ID,
        CONVERSATION_ID,
        'desktop-performance-origin',
      ) as SeedProjectionCounts;
      expect(seedProjectionCounts).toEqual({
        events: MESSAGE_COUNT,
        messages: MESSAGE_COUNT,
        timelineEntries: MESSAGE_COUNT,
        contiguousFrontier: MESSAGE_COUNT,
      });

      // Reopen the file to ensure the first tail/timeline reads use a cold
      // SQLite connection and a fresh statement/page cache.
      storage.close();
      storage = new SQLiteAgentStorage({ filename });
      let sql = attachSqlExecutionCounter(storage);

      sql.reset();
      const coldTail = await measured(() =>
        storage!.getMessagePage(CONVERSATION_ID, {
          limit: PAGE_LIMIT,
          maxBytes: PAGE_BYTES,
        })
      );
      sqlCounts.coldTail = sql.count();
      timings.coldTailMs = coldTail.elapsedMs;
      if (coldTail.value.reset) throw new Error('unexpected cold tail reset');
      expect(timings.coldTailMs).toBeLessThan(READ_BUDGET_MS);
      expect(coldTail.value.items).toHaveLength(PAGE_LIMIT);
      expect(coldTail.value.items.at(-1)?.messageId).toBe('message-100000');
      expect(responseBytes(coldTail.value)).toBeLessThanOrEqual(PAGE_BYTES);
      expect(sqlCounts.coldTail).toBeLessThanOrEqual(6);

      sql.reset();
      const hotTail = await measured(() =>
        storage!.getMessagePage(CONVERSATION_ID, {
          limit: PAGE_LIMIT,
          maxBytes: PAGE_BYTES,
        })
      );
      sqlCounts.hotTail = sql.count();
      timings.hotTailMs = hotTail.elapsedMs;
      if (hotTail.value.reset) throw new Error('unexpected hot tail reset');
      expect(timings.hotTailMs).toBeLessThan(READ_BUDGET_MS);
      expect(hotTail.value.items.map(item => item.messageId)).toEqual(
        coldTail.value.items.map(item => item.messageId),
      );

      sql.reset();
      const older = await storage.getMessagePage(CONVERSATION_ID, {
        limit: PAGE_LIMIT,
        maxBytes: PAGE_BYTES,
        before: coldTail.value.startCursor,
        expectedRevision: coldTail.value.revision,
      });
      sqlCounts.olderTail = sql.count();
      if (older.reset) throw new Error('unexpected older-page reset');
      expect(older.items).toHaveLength(PAGE_LIMIT);
      expect(older.items.at(-1)?.messageId).toBe('message-099950');
      expect(responseBytes(older)).toBeLessThanOrEqual(PAGE_BYTES);

      // Give the timeline cold measurement its own fresh connection instead
      // of inheriting the message-tail statement and page caches.
      storage.close();
      storage = new SQLiteAgentStorage({ filename });
      sql = attachSqlExecutionCounter(storage);
      const database = storage.db;
      const counted = createCountedDesktopProjection(storage);
      counted.resetCounts();
      sql.reset();
      const coldTimeline = await measured(() =>
        counted.projection.listTurns({
          conversationId: CONVERSATION_ID,
          limit: PAGE_LIMIT,
          byteBudget: PAGE_BYTES,
          renderLineBudget: PAGE_LIMIT,
        }, {})
      );
      sqlCounts.coldTimeline = sql.count();
      timings.coldTimelineMs = coldTimeline.elapsedMs;
      expect(timings.coldTimelineMs).toBeLessThan(READ_BUDGET_MS);
      expect(coldTimeline.value.items).toHaveLength(PAGE_LIMIT);
      expect(coldTimeline.value.items.at(-1)?.turnId).toBe('message-100000');
      expect(coldTimeline.value.budget.bytes).toBeLessThanOrEqual(PAGE_BYTES);
      expect(counted.counts()).toEqual({ prepareCalls: 0, timelineCalls: 1 });
      expect(sqlCounts.coldTimeline).toBeLessThanOrEqual(3);

      sql.reset();
      const hotTimeline = await measured(() =>
        counted.projection.listTurns({
          conversationId: CONVERSATION_ID,
          limit: PAGE_LIMIT,
          byteBudget: PAGE_BYTES,
          renderLineBudget: PAGE_LIMIT,
        }, {})
      );
      sqlCounts.hotTimeline = sql.count();
      timings.hotTimelineMs = hotTimeline.elapsedMs;
      expect(timings.hotTimelineMs).toBeLessThan(READ_BUDGET_MS);
      expect(hotTimeline.value.items.map(item => item.turnId)).toEqual(
        coldTimeline.value.items.map(item => item.turnId),
      );

      sql.reset();
      const olderTurns = await counted.projection.listTurns({
        conversationId: CONVERSATION_ID,
        direction: 'backward',
        cursor: coldTimeline.value.previousCursor,
        limit: PAGE_LIMIT,
        byteBudget: PAGE_BYTES,
        renderLineBudget: PAGE_LIMIT,
      }, {});
      sqlCounts.olderTimeline = sql.count();
      expect(olderTurns.items).toHaveLength(PAGE_LIMIT);
      expect(olderTurns.items.at(-1)?.turnId).toBe('message-099950');
      expect(olderTurns.budget.bytes).toBeLessThanOrEqual(PAGE_BYTES);
      expect(new Set(olderTurns.items.map(item => item.turnId))).not.toContain(
        coldTimeline.value.items[0]?.turnId,
      );

      const timeline = await storage.getConversationTimelinePage(CONVERSATION_ID, {
        limit: PAGE_LIMIT,
        maxBytes: PAGE_BYTES,
      });
      if (timeline.reset) throw new Error('unexpected timeline reset');
      expect(timeline).toMatchObject({
        totalMessages: MESSAGE_COUNT,
        totalTurns: MESSAGE_COUNT,
        totalEntries: MESSAGE_COUNT,
      });
      sql.reset();
      const middleTimeline = await storage.getConversationTimelinePage(CONVERSATION_ID, {
        limit: 1,
        maxBytes: PAGE_BYTES,
        aroundEntryIndex: 50_000,
        expectedRevision: timeline.revision,
      });
      sqlCounts.middleTimeline = sql.count();
      if (middleTimeline.reset || middleTimeline.items[0]?.kind !== 'message') {
        throw new Error('missing 50k timeline message');
      }
      const middleTurn = middleTimeline.items[0];
      expect(middleTurn.entryId).toBe('message-050001');

      sql.reset();
      const randomWindow = await measured(() =>
        storage!.getMessageWindowAround(
          CONVERSATION_ID,
          {
            focus: {
              kind: 'message',
              messageId: middleTurn.messageId,
              turnId: middleTurn.turnId,
              cursor: middleTurn.cursor,
            },
            expectedRevision: timeline.revision,
            maxMessages: PAGE_LIMIT,
            maxBytes: PAGE_BYTES,
          },
        )
      );
      sqlCounts.randomWindow50k = sql.count();
      timings.randomWindow50kMs = randomWindow.elapsedMs;
      expect(timings.randomWindow50kMs).toBeLessThan(READ_BUDGET_MS);
      if (randomWindow.value.reset) throw new Error('unexpected 50k window reset');
      expect(randomWindow.value.items).toHaveLength(PAGE_LIMIT);
      expect(randomWindow.value.items.some(item => item.messageId === middleTurn.messageId)).toBe(true);
      expect(responseBytes(randomWindow.value)).toBeLessThanOrEqual(PAGE_BYTES);
      expect(sqlCounts.randomWindow50k).toBeLessThanOrEqual(8);

      counted.resetCounts();
      sql.reset();
      const detail = await counted.projection.getTurnDetail({
        conversationId: CONVERSATION_ID,
        turnId: middleTurn.turnId,
        direction: 'forward',
        limit: PAGE_LIMIT,
        maxBytes: PAGE_BYTES,
      }, {});
      sqlCounts.turnDetail = sql.count();
      expect(detail.items.map(item => item.messageId)).toEqual([middleTurn.messageId]);
      expect(responseBytes(detail)).toBeLessThanOrEqual(PAGE_BYTES);
      // One indexed keyset query, one point projection read, and two bounded
      // existence probes. The limit hard-caps this path at page size + 3.
      expect(counted.counts().prepareCalls).toBeLessThanOrEqual(detail.items.length + 3);
      expect(sqlCounts.turnDetail).toBeLessThanOrEqual(detail.items.length + 3);

      const tailPlan = planDetails(
        database,
        `
        SELECT messageId FROM messages
        WHERE conversationId = ?
        ORDER BY timestamp DESC, lamportClock DESC, originNodeId DESC, messageId DESC
        LIMIT ?
      `,
        [CONVERSATION_ID, PAGE_LIMIT + 1],
      );
      expect(tailPlan).toContain('idx_messages_conversation_cursor');
      expect(tailPlan).not.toMatch(/SCAN messages/u);

      const timelinePlan = planDetails(
        database,
        `
        SELECT * FROM conversation_timeline_entries_v2
        WHERE conversationId = ? AND entryOrdinal >= ?
        ORDER BY entryOrdinal LIMIT ?
      `,
        [CONVERSATION_ID, 50_000, PAGE_LIMIT],
      );
      expect(timelinePlan).toContain('idx_timeline_entries_v2_ordinal');
      expect(timelinePlan).not.toMatch(/SCAN conversation_timeline_entries_v2/u);

      const focusPlan = planDetails(
        database,
        `
        SELECT * FROM conversation_timeline_entries_v2
        WHERE conversationId = ? AND kind = 'message' AND turnId = ? LIMIT 1
      `,
        [CONVERSATION_ID, middleTurn.turnId],
      );
      expect(focusPlan).toContain('idx_timeline_entries_v2_turn');

      const turnDetailPlan = planDetails(
        database,
        `
        SELECT messageId FROM messages
        WHERE conversationId = ? AND turnId = ?
        ORDER BY timestamp, lamportClock, originNodeId, messageId LIMIT ?
      `,
        [CONVERSATION_ID, middleTurn.turnId, PAGE_LIMIT + 1],
      );
      expect(turnDetailPlan).toContain('idx_messages_conversation_turn_cursor');
      expect(turnDetailPlan).not.toMatch(/SCAN messages/u);

      await storage.insertEventsIfAbsent([
        {
          eventId: 'desktop-compaction-1',
          conversationId: CONVERSATION_ID,
          originNodeId: 'desktop-compactor',
          originSequence: 1,
          lamportClock: MESSAGE_COUNT + 1,
          timestamp: 50_000,
          kind: 'compaction',
          mode: 'summary',
          boundary: {
            version: 2,
            coveredVersion: { 'desktop-performance-origin': 50_000 },
            coveredMessageCountByOrigin: { 'desktop-performance-origin': 50_000 },
            coveredUserTurnCountByOrigin: { 'desktop-performance-origin': 50_000 },
            droppedMessageCount: 50_000,
            droppedTurnCount: 50_000,
          },
          summary: { turnId: 'desktop-summary-turn-1', content: 'first compacted summary' },
        },
        {
          eventId: 'desktop-compaction-2',
          conversationId: CONVERSATION_ID,
          originNodeId: 'desktop-compactor',
          originSequence: 2,
          lamportClock: MESSAGE_COUNT + 2,
          timestamp: 75_000,
          kind: 'compaction',
          mode: 'summary',
          boundary: {
            version: 2,
            coveredVersion: { 'desktop-performance-origin': 75_000 },
            coveredMessageCountByOrigin: { 'desktop-performance-origin': 75_000 },
            coveredUserTurnCountByOrigin: { 'desktop-performance-origin': 75_000 },
            droppedMessageCount: 75_000,
            droppedTurnCount: 75_000,
          },
          summary: { turnId: 'desktop-summary-turn-2', content: 'second compacted summary' },
        },
      ]);

      const compactedTimeline = await storage.getConversationTimelinePage(CONVERSATION_ID, {
        limit: PAGE_LIMIT,
        maxBytes: PAGE_BYTES,
      });
      if (compactedTimeline.reset) throw new Error('unexpected compacted timeline reset');
      expect(compactedTimeline).toMatchObject({
        totalMessages: MESSAGE_COUNT,
        totalTurns: MESSAGE_COUNT,
        totalEntries: MESSAGE_COUNT + 2,
      });
      await expect(counted.projection.listTurns({
        conversationId: CONVERSATION_ID,
        direction: 'backward',
        cursor: coldTimeline.value.previousCursor,
        limit: PAGE_LIMIT,
        byteBudget: PAGE_BYTES,
        renderLineBudget: PAGE_LIMIT,
      }, {})).rejects.toThrow('conversation_turn_projection_cursor_reset');

      const compactionRow = database.prepare(`
        SELECT cursor FROM conversation_timeline_entries_v2
        WHERE conversationId = ? AND entryId = ?
      `).get(CONVERSATION_ID, 'desktop-compaction-2') as { cursor: string } | undefined;
      if (!compactionRow) throw new Error('missing repeated compaction timeline entry');
      sql.reset();
      const compactionWindow = await storage.getMessageWindowAround(CONVERSATION_ID, {
        focus: {
          kind: 'timeline-entry',
          entryId: 'desktop-compaction-2',
          cursor: compactionRow.cursor,
        },
        expectedRevision: compactedTimeline.revision,
        maxMessages: PAGE_LIMIT,
        maxBytes: PAGE_BYTES,
      });
      sqlCounts.compactionWindow = sql.count();
      if (compactionWindow.reset || compactionWindow.focus.kind !== 'compaction') {
        throw new Error('repeated compaction focus did not resolve');
      }
      expect(compactionWindow.focus).toMatchObject({
        entry: { entryId: 'desktop-compaction-2' },
        nearestPosition: 'after',
        nearestTurnId: 'message-075001',
      });
      expect(responseBytes(compactionWindow)).toBeLessThanOrEqual(PAGE_BYTES);

      sql.reset();
      const repeatedSeek = await measured(() =>
        storage!.getMessageWindowAround(
          CONVERSATION_ID,
          {
            focus: {
              kind: 'message',
              messageId: middleTurn.messageId,
              turnId: middleTurn.turnId,
              cursor: middleTurn.cursor,
            },
            expectedRevision: compactedTimeline.revision,
            maxMessages: PAGE_LIMIT,
            maxBytes: PAGE_BYTES,
          },
        )
      );
      sqlCounts.repeatedCompactionSeek = sql.count();
      timings.repeatedCompactionSeekMs = repeatedSeek.elapsedMs;
      expect(timings.repeatedCompactionSeekMs).toBeLessThan(READ_BUDGET_MS);
      if (repeatedSeek.value.reset) throw new Error('post-compaction seek reset');
      expect(repeatedSeek.value.items.some(item => item.messageId === middleTurn.messageId)).toBe(true);
      expect(responseBytes(repeatedSeek.value)).toBeLessThanOrEqual(PAGE_BYTES);

      process.stdout.write(`[desktop-sqlite-100k] ${
        JSON.stringify({
          platform: process.platform,
          seedBudgetMs: seedBudgetMs(process.platform),
          seedTransactions: seedTransactions.count(),
          seedProjectionCounts,
          timings,
          sqlCounts,
          resident: {
            tailItems: coldTail.value.items.length,
            tailBytes: responseBytes(coldTail.value),
            timelineItems: coldTimeline.value.items.length,
            timelineBytes: coldTimeline.value.budget.bytes,
            randomWindowItems: randomWindow.value.items.length,
            randomWindowBytes: responseBytes(randomWindow.value),
            detailItems: detail.items.length,
            detailPrepareCalls: counted.counts().prepareCalls,
          },
        })
      }\n`);
      expect(
        timings.seedMs,
        `100k single-transaction seed exceeded the ${process.platform} platform budget`,
      ).toBeLessThan(seedBudgetMs(process.platform));
    } finally {
      storage?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 90_000);
});
