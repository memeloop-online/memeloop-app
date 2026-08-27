import {
  type ChatMessage,
  ChatSyncEngine,
  type ConversationEvent,
  type ConversationEventCursor,
  type ConversationEventSyncPage,
  type ConversationMeta,
  messageToConversationEvent,
  type MessageVersionFrontier,
  type MessageVersionFrontierCursor,
  type MessageVersionFrontierPage,
  PeerNodeSyncAdapter,
  type PeerNodeTransport,
  type SyncIoOptions,
  type VersionRange,
  versionVectorKey,
} from 'memeloop';
import { SQLiteAgentStorage } from 'memeloop-cli';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const CONVERSATION_ID = 'main-conversation';
const OUT_OF_SCOPE_A = 'private-to-a';
const OUT_OF_SCOPE_B = 'private-to-b';

// Canonical, independently generated Ed25519 PeerIds. Keeping the actual
// PeerId strings in the route makes an accidental node-name shortcut visible.
const PEER_A = '12D3KooWKnDdG3iXw9eTFijk3EWSunZcFi54Zka4wmtqtt6rPxc8';
const PEER_B = '12D3KooWNZuG8phqhoNK9KWcUhwfzA3biDKNCUNVWEaJgigr6Acj';

interface RpcTrace {
  sourcePeerId: string;
  targetPeerId: string;
  operation: 'exchange-frontier' | 'pull-events' | 'push-events';
  conversationIds: string[];
}

interface SyncRpcEndpoint {
  exchangeVersionFrontierPage(
    localFrontiers: MessageVersionFrontier[],
    remoteAfter: MessageVersionFrontierCursor | undefined,
    includeRemotePage: boolean,
    conversationIds: string[] | undefined,
    options?: SyncIoOptions,
  ): Promise<{ remotePage: MessageVersionFrontierPage; missingForRemote: VersionRange[] }>;
  pullMissingEvents(
    conversationId: string,
    ranges: VersionRange[],
    cursor: ConversationEventCursor | undefined,
    options?: SyncIoOptions,
  ): Promise<ConversationEventSyncPage>;
  pushEvents(events: ConversationEvent[], options?: SyncIoOptions): Promise<void>;
}

class InMemoryPeerRpcTransport implements PeerNodeTransport {
  public constructor(
    public readonly nodeId: string,
    private readonly endpoints: ReadonlyMap<string, SyncRpcEndpoint>,
    private readonly trace: RpcTrace[],
  ) {}

  private endpoint(targetPeerId: string): SyncRpcEndpoint {
    if (targetPeerId === this.nodeId) throw new Error('sync_rpc_self_target');
    const endpoint = this.endpoints.get(targetPeerId);
    if (!endpoint) throw new Error(`sync_rpc_unknown_target:${targetPeerId}`);
    return endpoint;
  }

  public async exchangeVersionFrontierPage(
    targetPeerId: string,
    localFrontiers: MessageVersionFrontier[],
    remoteAfter: MessageVersionFrontierCursor | undefined,
    includeRemotePage: boolean,
    conversationIds?: string[],
    options?: SyncIoOptions,
  ): Promise<{ remotePage: MessageVersionFrontierPage; missingForRemote: VersionRange[] }> {
    this.trace.push({
      sourcePeerId: this.nodeId,
      targetPeerId,
      operation: 'exchange-frontier',
      conversationIds: [...(conversationIds ?? [])],
    });
    return await this.endpoint(targetPeerId).exchangeVersionFrontierPage(
      localFrontiers,
      remoteAfter,
      includeRemotePage,
      conversationIds,
      options,
    );
  }

  public async pullMissingEvents(
    targetPeerId: string,
    conversationId: string,
    ranges: VersionRange[],
    cursor?: ConversationEventCursor,
    options?: SyncIoOptions,
  ): Promise<ConversationEventSyncPage> {
    this.trace.push({
      sourcePeerId: this.nodeId,
      targetPeerId,
      operation: 'pull-events',
      conversationIds: [conversationId],
    });
    return await this.endpoint(targetPeerId).pullMissingEvents(
      conversationId,
      ranges,
      cursor,
      options,
    );
  }

  public async pushEvents(
    targetPeerId: string,
    events: ConversationEvent[],
    options?: SyncIoOptions,
  ): Promise<void> {
    this.trace.push({
      sourcePeerId: this.nodeId,
      targetPeerId,
      operation: 'push-events',
      conversationIds: [...new Set(events.map(event => event.conversationId))],
    });
    await this.endpoint(targetPeerId).pushEvents(events, options);
  }
}

function endpointFor(storage: SQLiteAgentStorage): SyncRpcEndpoint {
  return {
    async exchangeVersionFrontierPage(
      localFrontiers,
      remoteAfter,
      includeRemotePage,
      conversationIds,
      options,
    ) {
      options?.signal?.throwIfAborted();
      const remotePage = includeRemotePage
        ? await storage.getEventVersionFrontierPage({
          limit: 128,
          ...(remoteAfter ? { after: remoteAfter } : {}),
          ...(conversationIds ? { conversationIds } : {}),
          signal: options?.signal,
        })
        : { items: [] };
      const storedFrontiers = await storage.getEventVersionFrontiersForKeys(
        localFrontiers.map(frontier => ({
          conversationId: frontier.conversationId,
          originNodeId: frontier.originNodeId,
        })),
        { signal: options?.signal },
      );
      const storedByKey = new Map(storedFrontiers.map(frontier => [
        versionVectorKey(frontier.conversationId, frontier.originNodeId),
        frontier.maxContiguousOriginSequence,
      ]));
      const missingForRemote = localFrontiers.flatMap((frontier): VersionRange[] => {
        const stored = storedByKey.get(
          versionVectorKey(frontier.conversationId, frontier.originNodeId),
        ) ?? 0;
        return stored < frontier.maxContiguousOriginSequence
          ? [{
            conversationId: frontier.conversationId,
            originNodeId: frontier.originNodeId,
            fromExclusive: stored,
            toInclusive: frontier.maxContiguousOriginSequence,
          }]
          : [];
      });
      return { remotePage, missingForRemote };
    },
    async pullMissingEvents(conversationId, ranges, cursor, options) {
      options?.signal?.throwIfAborted();
      const page = await storage.getConversationEventPage(conversationId, {
        limit: 128,
        direction: 'forward',
        ...(cursor ? { after: cursor } : {}),
        ranges: ranges.map(range => ({
          originNodeId: range.originNodeId,
          fromExclusive: range.fromExclusive,
          toInclusive: range.toInclusive,
        })),
        signal: options?.signal,
      });
      return {
        items: page.items,
        ...(page.hasMoreAfter && page.endCursor ? { nextCursor: page.endCursor } : {}),
      };
    },
    async pushEvents(events, options) {
      options?.signal?.throwIfAborted();
      await storage.insertEventsIfAbsent(events);
    },
  };
}

function metadata(conversationId: string, originNodeId: string): ConversationMeta {
  return {
    conversationId,
    title: conversationId,
    lastMessagePreview: '',
    lastMessageTimestamp: 0,
    messageCount: 0,
    originNodeId,
    originClock: 0,
    definitionId: 'memeloop:general-assistant',
    isUserInitiated: true,
  };
}

function message(
  conversationId: string,
  originNodeId: string,
  messageId: string,
  content: string,
): ChatMessage {
  return {
    messageId,
    turnId: messageId,
    conversationId,
    originNodeId,
    originSequence: 1,
    lamportClock: 1,
    timestamp: 1,
    role: 'user',
    content,
  };
}

async function seed(
  storage: SQLiteAgentStorage,
  conversationId: string,
  originNodeId: string,
  messageId: string,
  content: string,
): Promise<void> {
  await storage.upsertConversationMetadata(metadata(conversationId, originNodeId));
  await storage.insertEventsIfAbsent([
    messageToConversationEvent(message(conversationId, originNodeId, messageId, content)),
  ]);
}

async function eventIds(
  storage: SQLiteAgentStorage,
  conversationId: string,
): Promise<string[]> {
  const page = await storage.getConversationEventPage(conversationId, {
    limit: 128,
    direction: 'forward',
  });
  expect(page.hasMoreAfter).toBe(false);
  return page.items.map(event => event.eventId).sort();
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Desktop current conversation sync integration', () => {
  it('merges two file-backed SQLite peers over bounded PeerId-routed event RPC and stays idempotent', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'memeloop-app-sync-'));
    temporaryDirectories.push(directory);
    const storageA = new SQLiteAgentStorage({ filename: path.join(directory, 'peer-a.db') });
    const storageB = new SQLiteAgentStorage({ filename: path.join(directory, 'peer-b.db') });
    try {
      await seed(storageA, CONVERSATION_ID, PEER_A, 'event-from-a', 'local A');
      await seed(storageB, CONVERSATION_ID, PEER_B, 'event-from-b', 'local B');
      await seed(storageA, OUT_OF_SCOPE_A, PEER_A, 'private-event-a', 'private A');
      await seed(storageB, OUT_OF_SCOPE_B, PEER_B, 'private-event-b', 'private B');

      const frontierCallsA = vi.spyOn(storageA, 'getEventVersionFrontierPage');
      const frontierCallsB = vi.spyOn(storageB, 'getEventVersionFrontierPage');
      const eventCallsA = vi.spyOn(storageA, 'getConversationEventPage');
      const eventCallsB = vi.spyOn(storageB, 'getConversationEventPage');
      const trace: RpcTrace[] = [];
      const endpoints = new Map<string, SyncRpcEndpoint>([
        [PEER_A, endpointFor(storageA)],
        [PEER_B, endpointFor(storageB)],
      ]);
      const engineA = new ChatSyncEngine({
        nodeId: PEER_A,
        storage: storageA,
        peers: () => [
          new PeerNodeSyncAdapter(
            PEER_B,
            new InMemoryPeerRpcTransport(PEER_A, endpoints, trace),
          ),
        ],
        conversationIds: [CONVERSATION_ID],
        failOnMessageSyncError: true,
      });
      const engineB = new ChatSyncEngine({
        nodeId: PEER_B,
        storage: storageB,
        peers: () => [
          new PeerNodeSyncAdapter(
            PEER_A,
            new InMemoryPeerRpcTransport(PEER_B, endpoints, trace),
          ),
        ],
        conversationIds: [CONVERSATION_ID],
        failOnMessageSyncError: true,
      });

      expect((await engineA.syncOnce()).complete).toBe(true);
      expect((await engineB.syncOnce()).complete).toBe(true);
      const convergedIds = ['event-from-a', 'event-from-b'];
      expect(await eventIds(storageA, CONVERSATION_ID)).toEqual(convergedIds);
      expect(await eventIds(storageB, CONVERSATION_ID)).toEqual(convergedIds);
      expect((await storageA.getMessages(CONVERSATION_ID)).map(item => item.originNodeId).sort())
        .toEqual([PEER_A, PEER_B].sort());
      expect((await storageB.getMessages(CONVERSATION_ID)).map(item => item.originNodeId).sort())
        .toEqual([PEER_A, PEER_B].sort());

      // The explicit conversation scope must not leak either peer's unrelated
      // local event into the other database.
      expect(await eventIds(storageA, OUT_OF_SCOPE_A)).toEqual(['private-event-a']);
      expect(await eventIds(storageB, OUT_OF_SCOPE_B)).toEqual(['private-event-b']);
      expect(await storageA.getConversationMeta(OUT_OF_SCOPE_B)).toBeNull();
      expect(await storageB.getConversationMeta(OUT_OF_SCOPE_A)).toBeNull();

      const firstFrontiersA = await storageA.getEventVersionFrontierPage({
        limit: 128,
        conversationIds: [CONVERSATION_ID],
      });
      const firstFrontiersB = await storageB.getEventVersionFrontierPage({
        limit: 128,
        conversationIds: [CONVERSATION_ID],
      });
      const retryA = await engineA.syncOnce();
      const retryB = await engineB.syncOnce();
      expect(retryA).toMatchObject({ complete: true, progress: { events: 0, bytes: 0 } });
      expect(retryB).toMatchObject({ complete: true, progress: { events: 0, bytes: 0 } });
      expect(await eventIds(storageA, CONVERSATION_ID)).toEqual(convergedIds);
      expect(await eventIds(storageB, CONVERSATION_ID)).toEqual(convergedIds);
      expect(
        await storageA.getEventVersionFrontierPage({
          limit: 128,
          conversationIds: [CONVERSATION_ID],
        }),
      ).toEqual(firstFrontiersA);
      expect(
        await storageB.getEventVersionFrontierPage({
          limit: 128,
          conversationIds: [CONVERSATION_ID],
        }),
      ).toEqual(firstFrontiersB);

      expect(trace).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourcePeerId: PEER_A, targetPeerId: PEER_B }),
        expect.objectContaining({ sourcePeerId: PEER_B, targetPeerId: PEER_A }),
      ]));
      expect(trace.every(call =>
        call.sourcePeerId !== call.targetPeerId &&
        call.conversationIds.every(conversationId => conversationId === CONVERSATION_ID)
      )).toBe(true);

      // These are pass-through spies over real SQLite ports. They lock the
      // integration to bounded frontier/event paging instead of the removed
      // metadata/snapshot sync mocks.
      for (const call of [...frontierCallsA.mock.calls, ...frontierCallsB.mock.calls]) {
        expect(call[0].limit).toBeGreaterThan(0);
        expect(call[0].limit).toBeLessThanOrEqual(128);
        if (call[0].conversationIds) expect(call[0].conversationIds).toEqual([CONVERSATION_ID]);
      }
      for (const call of [...eventCallsA.mock.calls, ...eventCallsB.mock.calls]) {
        expect(call[1].limit).toBeGreaterThan(0);
        expect(call[1].limit).toBeLessThanOrEqual(128);
      }
    } finally {
      storageA.close();
      storageB.close();
    }
  });
});
