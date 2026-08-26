/**
 * A deliberately content-free notification that a durable conversation
 * projection changed.  The SQLite event log remains the only source of
 * truth; consumers must re-read a bounded page after receiving this wake.
 */
export type ConversationMutationHint =
  | 'append'
  | 'tombstone'
  | 'compaction'
  | 'reset';

export interface ConversationMutationWake {
  conversationIds: string[];
  hint: ConversationMutationHint;
}

type MutationMethod =
  | 'appendLocalEvent'
  | 'appendLocalEventsAtomic'
  | 'insertEventsIfAbsent'
  | 'upsertConversationMetadata';

type StorageMethod = (...arguments_: unknown[]) => unknown;

/** Narrow storage shape needed by the observer, useful for host conformance tests. */
export interface ConversationMutationStorage {
  getConversationTimelinePage(
    conversationId: string,
    options: { limit: number; maxBytes: number },
  ): Promise<{ revision: string }>;
  listConversationsPage(
    options: { limit: number; maxBytes: number },
  ): Promise<{ revision: string }>;
}

interface MutationPlan {
  hints: Map<string, ConversationMutationHint>;
  /** Metadata-only writes advance the directory revision, not the timeline. */
  trackDirectoryRevision: boolean;
}

interface RevisionSnapshot {
  directory?: string;
  timelines: Map<string, string | undefined>;
}

const MUTATION_METHODS: readonly MutationMethod[] = [
  'appendLocalEvent',
  'appendLocalEventsAtomic',
  'insertEventsIfAbsent',
  'upsertConversationMetadata',
];

const HINT_ORDER: readonly ConversationMutationHint[] = [
  'append',
  'tombstone',
  'compaction',
  'reset',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function conversationIdOf(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.conversationId !== 'string') return undefined;
  const conversationId = value.conversationId.trim();
  return conversationId.length > 0 ? conversationId : undefined;
}

function hintForEvent(value: unknown): ConversationMutationHint | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.kind) {
    case 'message':
      return 'append';
    case 'tombstone':
      return 'tombstone';
    case 'compaction':
      return 'compaction';
    case 'metadataPatch':
      return 'reset';
    default:
      return undefined;
  }
}

function mergeHint(
  previous: ConversationMutationHint | undefined,
  next: ConversationMutationHint,
): ConversationMutationHint {
  if (!previous || previous === next) return next;
  // A mixed semantic batch cannot be incrementally interpreted by a reader.
  // Force a bounded reset while retaining one wake for this conversation.
  return 'reset';
}

function addHint(
  hints: Map<string, ConversationMutationHint>,
  value: unknown,
  hint: ConversationMutationHint,
): void {
  const conversationId = conversationIdOf(value);
  if (!conversationId) return;
  hints.set(conversationId, mergeHint(hints.get(conversationId), hint));
}

function createMutationPlan(
  method: MutationMethod,
  arguments_: unknown[],
): MutationPlan | undefined {
  const hints = new Map<string, ConversationMutationHint>();
  let trackDirectoryRevision = false;

  if (method === 'upsertConversationMetadata') {
    addHint(hints, arguments_[0], 'reset');
    trackDirectoryRevision = true;
  } else if (method === 'appendLocalEvent') {
    const draft = arguments_[0];
    const hint = hintForEvent(draft);
    if (hint) {
      addHint(hints, draft, hint);
      trackDirectoryRevision = hint === 'reset';
    }
  } else {
    const events = Array.isArray(arguments_[0]) ? arguments_[0] : [];
    for (const event of events) {
      const hint = hintForEvent(event);
      if (!hint) continue;
      addHint(hints, event, hint);
      trackDirectoryRevision ||= hint === 'reset';
    }
  }

  return hints.size > 0 ? { hints, trackDirectoryRevision } : undefined;
}

async function readRevisionSnapshot(
  storage: ConversationMutationStorage,
  conversationIds: readonly string[],
  trackDirectoryRevision: boolean,
): Promise<RevisionSnapshot | undefined> {
  try {
    const timelines = new Map<string, string | undefined>();
    for (const conversationId of conversationIds) {
      const page = await storage.getConversationTimelinePage(conversationId, {
        limit: 1,
        maxBytes: 64 * 1024,
      });
      timelines.set(conversationId, page.revision);
    }
    let directory: string | undefined;
    if (trackDirectoryRevision) {
      const page = await storage.listConversationsPage({
        limit: 1,
        maxBytes: 1024 * 1024,
      });
      directory = page.revision;
    }
    return { directory, timelines };
  } catch {
    // A failed revision probe must never turn a successful durable mutation
    // into a failed runtime operation. It also cannot safely produce a wake.
    return undefined;
  }
}

function changedConversationIds(
  plan: MutationPlan,
  before: RevisionSnapshot | undefined,
  after: RevisionSnapshot | undefined,
): string[] {
  if (!before || !after) return [];
  const directoryChanged = plan.trackDirectoryRevision && revisionAdvanced(
    before.directory,
    after.directory,
  );
  const changed: string[] = [];
  for (const conversationId of plan.hints.keys()) {
    const timelineChanged = revisionAdvanced(
      before.timelines.get(conversationId),
      after.timelines.get(conversationId),
    );
    if (timelineChanged || directoryChanged) changed.push(conversationId);
  }
  return changed;
}

function revisionAdvanced(
  before: string | undefined,
  after: string | undefined,
): boolean {
  if (after === undefined || before === after) return false;
  if (before === undefined) return true;
  const beforeNumber = Number(before);
  const afterNumber = Number(after);
  if (
    Number.isSafeInteger(beforeNumber) &&
    Number.isSafeInteger(afterNumber)
  ) return afterNumber > beforeNumber;
  // Opaque revisions are intentionally not ordered by the observer. A
  // changed opaque token is still a new committed snapshot; SQLite uses
  // monotonic decimal strings and takes the numeric branch above.
  return true;
}

/**
 * Wrap the four SQLite event ingress methods.  Wrapping the shared storage
 * object (rather than runtime status callbacks) observes local runs, sync,
 * tombstones and compaction uniformly, including writes with no agent-status
 * update.  The returned disposer restores the original methods exactly once.
 */
export function installConversationMutationObserver(
  storage: ConversationMutationStorage,
  notify: (wake: ConversationMutationWake) => void,
): () => void {
  const target = storage as unknown as Record<string, unknown>;
  const originals = new Map<MutationMethod, StorageMethod>();
  let disposed = false;

  for (const method of MUTATION_METHODS) {
    const original = target[method];
    if (typeof original !== 'function') continue;
    const originalMethod = original as StorageMethod;
    originals.set(method, originalMethod);
    target[method] = async (...arguments_: unknown[]): Promise<unknown> => {
      const plan = createMutationPlan(method, arguments_);
      if (!plan) return await Reflect.apply(originalMethod, storage, arguments_);
      const conversationIds = [...plan.hints.keys()];
      const before = await readRevisionSnapshot(
        storage,
        conversationIds,
        plan.trackDirectoryRevision,
      );
      // Errors intentionally pass through unchanged; no wake is sent for a
      // rolled-back/failed transaction.
      const result = await Reflect.apply(originalMethod, storage, arguments_);
      const after = await readRevisionSnapshot(
        storage,
        conversationIds,
        plan.trackDirectoryRevision,
      );
      if (!disposed) {
        const changed = changedConversationIds(plan, before, after);
        const byHint = new Map<ConversationMutationHint, string[]>();
        for (const conversationId of changed) {
          const hint = plan.hints.get(conversationId);
          if (!hint) continue;
          const ids = byHint.get(hint) ?? [];
          ids.push(conversationId);
          byHint.set(hint, ids);
        }
        for (const hint of HINT_ORDER) {
          const ids = byHint.get(hint);
          if (!ids || ids.length === 0) continue;
          try {
            notify({ conversationIds: ids, hint });
          } catch {
            // A notification consumer cannot turn a committed transaction
            // into a failed storage operation.
          }
        }
      }
      return result;
    };
  }

  return () => {
    if (disposed) return;
    disposed = true;
    for (const [method, original] of originals) {
      target[method] = original;
    }
    originals.clear();
  };
}
