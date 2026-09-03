import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDesktopAgentRuntimeProjectionStore } from '../sqliteAgentRuntimeProjectionStore';

describe('desktop SQLite agent RPC projections', () => {
  let database: Database.Database;

  beforeEach(() => {
    database = new Database(':memory:');
    database.exec(`
      CREATE TABLE conversations (
        conversationId TEXT PRIMARY KEY, title TEXT, lastMessagePreview TEXT,
        lastMessageTimestamp INTEGER, messageCount INTEGER, originNodeId TEXT,
        originClock INTEGER, definitionId TEXT, instanceDeltaJson TEXT,
        isUserInitiated INTEGER, sourceChannelJson TEXT
      );
      CREATE TABLE messages (
        messageId TEXT, conversationId TEXT, originNodeId TEXT,
        originSequence INTEGER, turnId TEXT, timestamp INTEGER,
        lamportClock INTEGER, role TEXT, content TEXT, partsJson TEXT,
        toolCallsJson TEXT, attachmentsJson TEXT, detailRefJson TEXT,
        reasoningContent TEXT, contentType TEXT, hidden INTEGER,
        duration INTEGER, metadataJson TEXT,
        PRIMARY KEY (conversationId, messageId)
      );
      CREATE TABLE conversation_turn_tombstones (
        conversationId TEXT, turnId TEXT, PRIMARY KEY (conversationId, turnId)
      );
      CREATE INDEX idx_messages_conversation_turn_cursor
        ON messages(conversationId, turnId, timestamp, lamportClock, originNodeId, messageId);
    `);
    const insertConversation = database.prepare(`
      INSERT INTO conversations VALUES (?, ?, '', ?, ?, 'desktop-node', 1, ?, NULL, 1, NULL)
    `);
    insertConversation.run('conversation-allowed', 'Allowed', 4, 4, 'definition-allowed');
    insertConversation.run('conversation-denied', 'Denied', 5, 1, 'definition-denied');
    insertMessage('conversation-allowed', 'turn-1', 'turn-1', 'user', 'question', 1);
    insertMessage('conversation-allowed', 'answer-1', 'turn-1', 'assistant', 'answer one', 2);
    insertMessage('conversation-allowed', 'answer-2', 'turn-1', 'assistant', 'answer two', 3);
    insertMessage('conversation-allowed', 'turn-2', 'turn-2', 'user', 'second question', 4);
    insertMessage('conversation-denied', 'denied-turn', 'denied-turn', 'user', 'private', 5);
  });

  afterEach(() => {
    database.close();
  });

  function insertMessage(
    conversationId: string,
    messageId: string,
    turnId: string,
    role: 'user' | 'assistant',
    content: string,
    timestamp: number,
  ): void {
    database.prepare(`
      INSERT INTO messages (
        messageId, conversationId, originNodeId, originSequence, turnId,
        timestamp, lamportClock, role, content, partsJson
      ) VALUES (?, ?, 'desktop-node', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      messageId,
      conversationId,
      timestamp,
      turnId,
      timestamp,
      timestamp,
      role,
      content,
      JSON.stringify([{ type: 'text', text: content }]),
    );
  }

  function projections() {
    return createDesktopAgentRuntimeProjectionStore({
      db: database,
      getConversationTimelinePage: async (
        conversationId: string,
        options: {
          limit: number;
          beforeCursor?: string;
          afterCursor?: string;
          expectedRevision?: string;
        },
      ) => {
        const revision = 'revision-1';
        if (options.expectedRevision !== undefined && options.expectedRevision !== revision) {
          return { reset: true as const, revision };
        }
        const timelineItems = [
          {
            kind: 'message' as const,
            entryId: 'turn-1',
            messageId: 'turn-1',
            turnId: 'turn-1',
            conversationId,
            timestamp: 1,
            lamportClock: 1,
            originNodeId: 'desktop-node',
            cursor: 'timeline-1',
            entryIndex: 0,
            turnIndex: 0,
            role: 'user' as const,
            actorId: 'user',
            actorLabel: 'User',
            preview: 'question',
          },
          {
            kind: 'message' as const,
            entryId: 'turn-2',
            messageId: 'turn-2',
            turnId: 'turn-2',
            conversationId,
            timestamp: 4,
            lamportClock: 4,
            originNodeId: 'desktop-node',
            cursor: 'timeline-2',
            entryIndex: 1,
            turnIndex: 1,
            role: 'user' as const,
            actorId: 'user',
            actorLabel: 'User',
            preview: 'second question',
          },
        ];
        const suppliedCursor = options.beforeCursor ?? options.afterCursor;
        const suppliedIndex = suppliedCursor === undefined
          ? undefined
          : timelineItems.findIndex(item => item.cursor === suppliedCursor);
        if (suppliedCursor !== undefined && suppliedIndex === -1) {
          return { reset: true as const, revision };
        }
        const start = options.afterCursor === undefined
          ? Math.max(0, (suppliedIndex ?? timelineItems.length) - options.limit)
          : suppliedIndex! + 1;
        const end = options.afterCursor === undefined
          ? suppliedIndex ?? timelineItems.length
          : Math.min(timelineItems.length, start + options.limit);
        return {
          reset: false as const,
          revision,
          totalMessages: 4,
          totalTurns: 2,
          totalEntries: 2,
          hasMoreBefore: start > 0,
          hasMoreAfter: end < timelineItems.length,
          items: timelineItems.slice(start, end),
        };
      },
    } as never);
  }

  it('applies grant scopes in SQL before conversation ordering and decoding', async () => {
    const page = await projections().listConversations(
      { limit: 50, direction: 'backward' },
      {
        allowedConversationIds: ['conversation-allowed'],
        allowedDefinitionIds: ['definition-allowed'],
        scopeKey: 'grant-scope',
      },
    );
    expect(page.items.map(item => item.conversationId)).toEqual(['conversation-allowed']);
  });

  it('uses the persisted timeline and exact turn keyset without leaking adjacent turns', async () => {
    const store = projections();
    const turns = await store.listTurns({
      conversationId: 'conversation-allowed',
      limit: 50,
      byteBudget: 256 * 1024,
      renderLineBudget: 100,
    }, {});
    expect(turns.items.map(item => item.turnId)).toEqual(['turn-1', 'turn-2']);

    const first = await store.getTurnDetail({
      conversationId: 'conversation-allowed',
      turnId: 'turn-1',
      direction: 'forward',
      limit: 2,
      maxBytes: 256 * 1024,
    }, {});
    expect(first.items.map(item => item.messageId)).toEqual(['turn-1', 'answer-1']);
    expect(first.hasMoreAfter).toBe(true);

    const second = await store.getTurnDetail({
      conversationId: 'conversation-allowed',
      turnId: 'turn-1',
      direction: 'forward',
      cursor: first.nextCursor,
      limit: 2,
      maxBytes: 256 * 1024,
    }, {});
    expect(second.items.map(item => item.messageId)).toEqual(['answer-2']);
    expect(second.items.every(item => item.turnId === 'turn-1')).toBe(true);
    expect(second.hasMoreAfter).toBe(false);
  });

  it('binds an opaque turn cursor to the persisted timeline revision', async () => {
    const store = projections();
    const tail = await store.listTurns({
      conversationId: 'conversation-allowed',
      direction: 'backward',
      limit: 1,
    }, {});
    expect(tail.items.map(item => item.turnId)).toEqual(['turn-2']);

    const older = await store.listTurns({
      conversationId: 'conversation-allowed',
      direction: 'backward',
      cursor: tail.previousCursor,
      limit: 1,
    }, {});
    expect(older.items.map(item => item.turnId)).toEqual(['turn-1']);
    await expect(store.listTurns({
      conversationId: 'conversation-denied',
      cursor: tail.previousCursor,
      limit: 1,
    }, {})).rejects.toThrow('conversation_turn_projection_cursor_invalid');
  });
});
