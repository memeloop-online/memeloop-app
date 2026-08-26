import { createHash } from 'node:crypto';

import {
  AGENT_DEVICE_RPC_LIMITS,
  type AgentRuntimeRpcProjectionStore,
  type AgentRuntimeRpcStorage,
  canonicalJsonBytes,
  type ChatMessage,
  type ConversationMessageCursor,
  type ConversationMeta,
  projectConversationMessageForList,
} from 'memeloop';

interface SqliteStatement {
  all(...parameters: unknown[]): unknown[];
  get(...parameters: unknown[]): unknown;
}

interface SqliteDatabase {
  prepare(source: string): SqliteStatement;
  transaction<T>(operation: () => T): () => T;
}

interface ProjectionCapableStorage extends AgentRuntimeRpcStorage {
  /** SQLiteAgentStorage keeps its connection private at the TS boundary. */
  db: SqliteDatabase;
}

interface ConversationRow {
  conversationId: string;
  title: string;
  lastMessagePreview: string;
  lastMessageTimestamp: number;
  messageCount: number;
  originNodeId: string;
  originClock: number;
  definitionId: string;
  instanceDeltaJson: string | null;
  isUserInitiated: number;
  sourceChannelJson: string | null;
}

interface MessageRow {
  messageId: string;
  conversationId: string;
  originNodeId: string;
  originSequence: number;
  turnId: string;
  timestamp: number;
  lamportClock: number;
  role: ChatMessage['role'];
  content: string;
  partsJson: string | null;
  toolCallsJson: string | null;
  attachmentsJson: string | null;
  detailRefJson: string | null;
  reasoningContent: string | null;
  contentType: string | null;
  hidden: number | null;
  duration: number | null;
  metadataJson: string | null;
}

interface MessageIndexRow extends ConversationMessageCursor {
  turnId: string;
}

interface ConversationCursor {
  v: 1;
  scope: string;
  timestamp: number;
  conversationId: string;
}

interface TurnDetailCursor extends ConversationMessageCursor {
  v: 1;
  conversationId: string;
  turnId: string;
}

interface TurnListCursor {
  v: 1;
  conversationId: string;
  revision: string;
  timelineCursor: string;
}

const MAX_TURN_MESSAGE_PROJECTION_BYTES = AGENT_DEVICE_RPC_LIMITS.messageProjectionBytes;

function jsonBytes(value: unknown): number {
  return canonicalJsonBytes(value, {
    maxBytes: AGENT_DEVICE_RPC_LIMITS.projectionPageMaxBytes,
    maxStringBytes: AGENT_DEVICE_RPC_LIMITS.projectionPageMaxBytes,
    maxStringCodeUnits: AGENT_DEVICE_RPC_LIMITS.projectionPageMaxBytes,
  }).byteLength;
}

function scopeDigest(scopeKey: string): string {
  return createHash('sha256').update(scopeKey).digest('base64url');
}

function encodeCursor(value: ConversationCursor | TurnDetailCursor | TurnListCursor): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor<T>(value: string | undefined, guard: (candidate: unknown) => candidate is T): T | undefined {
  if (!value || value.length > 4096) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return guard(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isConversationCursor(value: unknown): value is ConversationCursor {
  return isRecord(value) && value.v === 1 && typeof value.scope === 'string' &&
    Number.isSafeInteger(value.timestamp) && typeof value.conversationId === 'string';
}

function isTurnDetailCursor(value: unknown): value is TurnDetailCursor {
  return isRecord(value) && value.v === 1 && typeof value.conversationId === 'string' &&
    typeof value.turnId === 'string' && typeof value.messageId === 'string' &&
    typeof value.originNodeId === 'string' && Number.isSafeInteger(value.timestamp) &&
    Number.isSafeInteger(value.lamportClock);
}

function isTurnListCursor(value: unknown): value is TurnListCursor {
  return isRecord(value) && value.v === 1 && typeof value.conversationId === 'string' &&
    typeof value.revision === 'string' && typeof value.timelineCursor === 'string';
}

function assertSqliteStorage(storage: AgentRuntimeRpcStorage): ProjectionCapableStorage {
  const database = (storage as unknown as { db?: Partial<SqliteDatabase> }).db;
  if (!database || typeof database.prepare !== 'function' || typeof database.transaction !== 'function') {
    throw new Error('memeloop_sqlite_projection_database_unavailable');
  }
  return storage as ProjectionCapableStorage;
}

function conversationMeta(row: ConversationRow): ConversationMeta {
  return {
    conversationId: row.conversationId,
    title: row.title,
    lastMessagePreview: row.lastMessagePreview,
    lastMessageTimestamp: row.lastMessageTimestamp,
    messageCount: row.messageCount,
    originNodeId: row.originNodeId,
    originClock: row.originClock,
    definitionId: row.definitionId,
    isUserInitiated: Boolean(row.isUserInitiated),
    ...(row.instanceDeltaJson
      ? { instanceDelta: JSON.parse(row.instanceDeltaJson) as Record<string, unknown> }
      : {}),
    ...(row.sourceChannelJson
      ? { sourceChannel: JSON.parse(row.sourceChannelJson) as ConversationMeta['sourceChannel'] }
      : {}),
  };
}

function chatMessage(row: MessageRow): ChatMessage {
  return {
    messageId: row.messageId,
    conversationId: row.conversationId,
    originNodeId: row.originNodeId,
    originSequence: row.originSequence,
    turnId: row.turnId,
    timestamp: row.timestamp,
    lamportClock: row.lamportClock,
    role: row.role,
    content: row.content,
    ...(row.partsJson ? { parts: JSON.parse(row.partsJson) as ChatMessage['parts'] } : {}),
    ...(row.toolCallsJson ? { toolCalls: JSON.parse(row.toolCallsJson) as ChatMessage['toolCalls'] } : {}),
    ...(row.attachmentsJson ? { attachments: JSON.parse(row.attachmentsJson) as ChatMessage['attachments'] } : {}),
    ...(row.detailRefJson ? { detailRef: JSON.parse(row.detailRefJson) as ChatMessage['detailRef'] } : {}),
    ...(row.reasoningContent === null ? {} : { reasoning_content: row.reasoningContent }),
    ...(row.contentType === null ? {} : { contentType: row.contentType }),
    ...(row.hidden === null ? {} : { hidden: Boolean(row.hidden) }),
    ...(row.duration === null ? {} : { duration: row.duration }),
    ...(row.metadataJson ? { metadata: JSON.parse(row.metadataJson) as ChatMessage['metadata'] } : {}),
  };
}

function placeholders(values: readonly string[]): string {
  return values.map(() => '?').join(', ');
}

function scopedConversationWhere(
  context: Parameters<AgentRuntimeRpcProjectionStore['listConversations']>[1],
): { sql: string; parameters: string[] } {
  const clauses: string[] = [];
  const parameters: string[] = [];
  if (context.allowedConversationIds !== undefined) {
    clauses.push(`conversationId IN (${placeholders(context.allowedConversationIds)})`);
    parameters.push(...context.allowedConversationIds);
  }
  if (context.allowedDefinitionIds !== undefined) {
    clauses.push(`definitionId IN (${placeholders(context.allowedDefinitionIds)})`);
    parameters.push(...context.allowedDefinitionIds);
  }
  return { sql: clauses.length > 0 ? clauses.join(' AND ') : '1 = 1', parameters };
}

function messageCursorValues(cursor: ConversationMessageCursor): unknown[] {
  return [cursor.timestamp, cursor.lamportClock, cursor.originNodeId, cursor.messageId];
}

function messageCursorPredicate(operator: '<' | '>'): string {
  return `(timestamp, lamportClock, originNodeId, messageId) ${operator} (?, ?, ?, ?)`;
}

/**
 * App-owned indexed SQLite projections for the three collection RPCs that
 * Core intentionally refuses to derive by scanning an event log.
 */
export function createDesktopAgentRuntimeProjectionStore(
  runtimeStorage: AgentRuntimeRpcStorage,
): AgentRuntimeRpcProjectionStore {
  const storage = assertSqliteStorage(runtimeStorage);
  const database = storage.db;

  return {
    async listConversations(request, context) {
      context.signal?.throwIfAborted();
      const limit = Math.min(request.limit ?? 50, AGENT_DEVICE_RPC_LIMITS.conversationListPage);
      const direction = request.direction ?? 'backward';
      const digest = scopeDigest(context.scopeKey);
      const supplied = decodeCursor(request.cursor, isConversationCursor);
      if (request.cursor !== undefined && (!supplied || supplied.scope !== digest)) {
        throw new Error('conversation_projection_cursor_invalid');
      }
      const cursor = supplied?.scope === digest ? supplied : undefined;
      const scope = scopedConversationWhere(context);
      const readingForward = direction === 'forward';
      const conditions = [scope.sql];
      const parameters: unknown[] = [...scope.parameters];
      if (cursor) {
        conditions.push(`(lastMessageTimestamp, conversationId) ${readingForward ? '>' : '<'} (?, ?)`);
        parameters.push(cursor.timestamp, cursor.conversationId);
      }
      const order = readingForward ? 'ASC' : 'DESC';
      let rows = database.prepare(`
        SELECT conversationId, title, lastMessagePreview, lastMessageTimestamp,
               messageCount, originNodeId, originClock, definitionId,
               instanceDeltaJson, isUserInitiated, sourceChannelJson
        FROM conversations
        WHERE ${conditions.join(' AND ')}
        ORDER BY lastMessageTimestamp ${order}, conversationId ${order}
        LIMIT ?
      `).all(...parameters, limit + 1) as ConversationRow[];
      const hasExtra = rows.length > limit;
      if (hasExtra) rows = rows.slice(0, limit);
      if (!readingForward) rows.reverse();
      let items = rows.map(conversationMeta);
      let byteTrimmed = false;
      const cursorFor = (row: ConversationRow): string =>
        encodeCursor({
          v: 1,
          scope: digest,
          timestamp: row.lastMessageTimestamp,
          conversationId: row.conversationId,
        });
      const build = () => {
        const first = rows[0];
        const last = rows.at(-1);
        return {
          items,
          hasMoreBefore: readingForward ? request.cursor !== undefined : hasExtra || byteTrimmed,
          hasMoreAfter: readingForward ? hasExtra || byteTrimmed : request.cursor !== undefined,
          ...(first ? { previousCursor: cursorFor(first) } : {}),
          ...(last ? { nextCursor: cursorFor(last) } : {}),
          ...(request.seenCursor === undefined ? {} : {
            seenCursorFound: (() => {
              const seen = decodeCursor(request.seenCursor, isConversationCursor);
              if (!seen || seen.scope !== digest) return false;
              return database.prepare(`
                SELECT 1 FROM conversations
                WHERE ${scope.sql} AND lastMessageTimestamp = ? AND conversationId = ?
                LIMIT 1
              `).get(...scope.parameters, seen.timestamp, seen.conversationId) !== undefined;
            })(),
          }),
        };
      };
      for (;;) {
        const response = build();
        if (jsonBytes(response) <= AGENT_DEVICE_RPC_LIMITS.conversationListBytes) {
          context.signal?.throwIfAborted();
          return response;
        }
        if (items.length <= 1) throw new Error('conversation_projection_item_exceeds_byte_budget');
        byteTrimmed = true;
        if (readingForward) {
          rows = rows.slice(0, -1);
          items = items.slice(0, -1);
        } else {
          rows = rows.slice(1);
          items = items.slice(1);
        }
      }
    },

    async listTurns(request, context) {
      context.signal?.throwIfAborted();
      const limit = Math.min(request.limit ?? 50, 64);
      const maxBytes = Math.min(
        request.byteBudget ?? AGENT_DEVICE_RPC_LIMITS.projectionPageDefaultBytes,
        AGENT_DEVICE_RPC_LIMITS.timelinePageMaxBytes,
      );
      const readingForward = request.direction === 'forward';
      const supplied = decodeCursor(request.cursor, isTurnListCursor);
      if (
        request.cursor !== undefined && (
          !supplied || supplied.conversationId !== request.conversationId
        )
      ) throw new Error('conversation_turn_projection_cursor_invalid');
      const page = await storage.getConversationTimelinePage(request.conversationId, {
        limit,
        maxBytes,
        previewLength: AGENT_DEVICE_RPC_LIMITS.timelinePreviewCharacters,
        ...(supplied === undefined
          ? {}
          : readingForward
          ? { afterCursor: supplied.timelineCursor, expectedRevision: supplied.revision }
          : { beforeCursor: supplied.timelineCursor, expectedRevision: supplied.revision }),
      }, { signal: context.signal });
      context.signal?.throwIfAborted();
      if (page.reset) throw new Error('conversation_turn_projection_cursor_reset');
      const cursorFor = (timelineCursor: string): string =>
        encodeCursor({
          v: 1,
          conversationId: request.conversationId,
          revision: page.revision,
          timelineCursor,
        });
      let seenCursorFound: boolean | undefined;
      if (request.seenCursor !== undefined) {
        const seen = decodeCursor(request.seenCursor, isTurnListCursor);
        if (!seen || seen.conversationId !== request.conversationId || seen.revision !== page.revision) {
          seenCursorFound = false;
        } else if (page.items.some(entry => entry.cursor === seen.timelineCursor)) {
          seenCursorFound = true;
        } else {
          const probe = await storage.getConversationTimelinePage(request.conversationId, {
            limit: 1,
            maxBytes: Math.min(maxBytes, 64 * 1024),
            previewLength: AGENT_DEVICE_RPC_LIMITS.timelinePreviewCharacters,
            beforeCursor: seen.timelineCursor,
            expectedRevision: seen.revision,
          }, { signal: context.signal });
          seenCursorFound = !probe.reset;
        }
      }
      let items = page.items.map(entry =>
        entry.kind === 'turn'
          ? {
            turnId: entry.turnId,
            conversationId: entry.conversationId,
            cursor: cursorFor(entry.cursor),
            startedAt: entry.timestamp,
            updatedAt: entry.timestamp,
            userPreview: entry.userPreview,
            participantPreviews: entry.participantPreviews,
            responseCount: entry.responseCount,
            isCompaction: false,
            isTombstone: false,
            detailState: 'notLoaded' as const,
          }
          : {
            turnId: entry.entryId,
            conversationId: entry.conversationId,
            cursor: cursorFor(entry.cursor),
            startedAt: entry.timestamp,
            updatedAt: entry.timestamp,
            userPreview: entry.summaryPreview,
            participantPreviews: [],
            responseCount: 0,
            isCompaction: true,
            compactedMessageCount: entry.compactedMessageCount,
            isTombstone: false,
            detailState: 'notLoaded' as const,
          }
      );
      let renderLines = items.reduce((total, item) => total + 1 + item.participantPreviews.length, 0);
      let truncated = false;
      const build = () => ({
        items,
        hasMoreBefore: page.hasMoreBefore || (!readingForward && truncated),
        hasMoreAfter: page.hasMoreAfter || (readingForward && truncated),
        ...(items[0] ? { previousCursor: items[0].cursor } : {}),
        ...(items.at(-1) ? { nextCursor: items.at(-1)!.cursor } : {}),
        ...(seenCursorFound === undefined ? {} : { seenCursorFound }),
        budget: { bytes: 0, renderLines, truncated },
      });
      for (;;) {
        const provisional = build();
        // The decimal byte count itself changes the envelope size; two passes
        // reach the fixed-width representation without retaining another page.
        for (let pass = 0; pass < 2; pass += 1) {
          provisional.budget.bytes = jsonBytes(provisional);
        }
        if (
          provisional.budget.bytes <= maxBytes &&
          renderLines <= (request.renderLineBudget ?? AGENT_DEVICE_RPC_LIMITS.turnRenderLines)
        ) return provisional;
        if (items.length === 0) throw new Error('turn_projection_item_exceeds_budget');
        truncated = true;
        if (readingForward) items = items.slice(0, -1);
        else items = items.slice(1);
        renderLines = items.reduce((total, item) => total + 1 + item.participantPreviews.length, 0);
      }
    },

    async getTurnDetail(request, context) {
      context.signal?.throwIfAborted();
      const limit = Math.min(request.limit ?? 50, AGENT_DEVICE_RPC_LIMITS.turnDetailPage);
      const maximumBytes = request.maxBytes ?? AGENT_DEVICE_RPC_LIMITS.turnDetailDefaultBytes;
      const readingForward = request.direction !== 'backward';
      const supplied = decodeCursor(request.cursor, isTurnDetailCursor);
      if (
        request.cursor !== undefined && (
          !supplied || supplied.conversationId !== request.conversationId ||
          supplied.turnId !== request.turnId
        )
      ) throw new Error('turn_detail_projection_cursor_invalid');
      const cursor = supplied?.conversationId === request.conversationId && supplied.turnId === request.turnId
        ? supplied
        : undefined;
      const result = database.transaction(() => {
        const base = `
          conversationId = ? AND turnId = ?
          AND (hidden IS NULL OR hidden = 0)
          AND NOT EXISTS (
            SELECT 1 FROM conversation_turn_tombstones AS tombstone
            WHERE tombstone.conversationId = messages.conversationId
              AND tombstone.turnId = messages.turnId
          )
        `;
        const conditions = [base];
        const parameters: unknown[] = [request.conversationId, request.turnId];
        if (cursor) {
          conditions.push(messageCursorPredicate(readingForward ? '>' : '<'));
          parameters.push(...messageCursorValues(cursor));
        }
        const order = readingForward ? 'ASC' : 'DESC';
        let indexRows = database.prepare(`
          SELECT messageId, turnId, timestamp, lamportClock, originNodeId
          FROM messages
          WHERE ${conditions.join(' AND ')}
          ORDER BY timestamp ${order}, lamportClock ${order}, originNodeId ${order}, messageId ${order}
          LIMIT ?
        `).all(...parameters, limit + 1) as MessageIndexRow[];
        const hasExtra = indexRows.length > limit;
        if (hasExtra) indexRows = indexRows.slice(0, limit);
        if (!readingForward) indexRows.reverse();

        const items: ChatMessage[] = [];
        let byteStopped = false;
        for (const indexRow of indexRows) {
          const row = database.prepare(`
            SELECT * FROM messages WHERE conversationId = ? AND messageId = ? LIMIT 1
          `).get(request.conversationId, indexRow.messageId) as MessageRow | undefined;
          if (!row) continue;
          const projected = projectConversationMessageForList(
            chatMessage(row),
            Math.min(MAX_TURN_MESSAGE_PROJECTION_BYTES, Math.max(1, maximumBytes - 4_096)),
          );
          const candidate = {
            turnId: request.turnId,
            items: [...items, projected],
            hasMoreBefore: false,
            hasMoreAfter: false,
          };
          if (jsonBytes(candidate) > maximumBytes) {
            byteStopped = true;
            break;
          }
          items.push(projected);
        }
        const first = items[0];
        const last = items.at(-1);
        const cursorFor = (message: ChatMessage): string =>
          encodeCursor({
            v: 1,
            conversationId: request.conversationId,
            turnId: request.turnId,
            timestamp: message.timestamp,
            lamportClock: message.lamportClock,
            originNodeId: message.originNodeId,
            messageId: message.messageId,
          });
        const existsBeyond = (edge: ChatMessage | undefined, operator: '<' | '>'): boolean => {
          if (!edge) return false;
          return database.prepare(`
            SELECT 1 FROM messages
            WHERE ${base} AND ${messageCursorPredicate(operator)}
            LIMIT 1
          `).get(
            request.conversationId,
            request.turnId,
            ...messageCursorValues(edge),
          ) !== undefined;
        };
        return {
          turnId: request.turnId,
          items,
          hasMoreBefore: existsBeyond(first, '<') || (!readingForward && (hasExtra || byteStopped)),
          hasMoreAfter: existsBeyond(last, '>') || (readingForward && (hasExtra || byteStopped)),
          ...(first ? { previousCursor: cursorFor(first) } : {}),
          ...(last ? { nextCursor: cursorFor(last) } : {}),
          ...(request.seenCursor === undefined ? {} : {
            seenCursorFound: (() => {
              const seen = decodeCursor(request.seenCursor, isTurnDetailCursor);
              if (
                !seen || seen.conversationId !== request.conversationId ||
                seen.turnId !== request.turnId
              ) return false;
              return database.prepare(`
                SELECT 1 FROM messages WHERE ${base}
                  AND timestamp = ? AND lamportClock = ? AND originNodeId = ? AND messageId = ?
                LIMIT 1
              `).get(
                request.conversationId,
                request.turnId,
                ...messageCursorValues(seen),
              ) !== undefined;
            })(),
          }),
        };
      })();
      context.signal?.throwIfAborted();
      return result;
    },
  };
}
