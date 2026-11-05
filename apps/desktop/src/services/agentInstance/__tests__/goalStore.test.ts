/** @vitest-environment node */
import type { AgentGoal } from 'memeloop';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteGoalStore } from '../goalStore';

const makeGoal = (conversationId = 'conversation'): AgentGoal => ({
  id: 'goal',
  conversationId,
  definitionId: 'assistant',
  executionNodeId: 'desktop',
  objective: 'Prepare a plan from the knowledge base',
  status: 'active',
  revision: 1,
  round: 1,
  pendingRound: { requestId: 'request-1', turnId: 'turn-1', message: 'Continue', runId: 'run-1' },
  updatedAt: '2026-11-04T00:00:00.000Z',
});

describe('SqliteGoalStore', () => {
  let directory: string;
  let store: SqliteGoalStore;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'memeloop-goals-'));
    store = new SqliteGoalStore(path.join(directory, 'goals.sqlite'));
  });
  afterEach(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('recovers the pending round identity after the database is reopened', async () => {
    const goal = makeGoal();
    expect(await store.save(goal, null)).toBe(true);
    goal.pendingRound!.message = 'Changed by caller';
    store.close();
    store = new SqliteGoalStore(path.join(directory, 'goals.sqlite'));
    expect(await store.get(goal.conversationId)).toEqual(makeGoal());
    expect(await store.get('missing')).toBeNull();
  });

  it('keeps a persisted pause when a stale completion races it', async () => {
    const goal = makeGoal();
    expect(await store.save(goal, null)).toBe(true);
    expect(await store.save(goal, null)).toBe(false);
    expect(
      await Promise.all([
        store.save({ ...goal, revision: 2, status: 'paused' }, 1),
        store.save({ ...goal, revision: 2, status: 'completed', evidence: 'old round' }, 1),
      ]),
    ).toEqual([true, false]);
    expect(await store.get(goal.conversationId)).toMatchObject({ revision: 2, status: 'paused' });
  });

  it('restores this node active goals with a bounded keyset page', async () => {
    for (let index = 0; index < 105; index++) {
      await store.save(makeGoal(`conversation-${String(index).padStart(3, '0')}`), null);
    }
    await store.save({ ...makeGoal('paused'), status: 'paused' }, null);
    await store.save({ ...makeGoal('remote'), executionNodeId: 'other-device' }, null);
    const first = await store.listActive('desktop');
    expect(first.items).toHaveLength(100);
    const second = await store.listActive('desktop', first.nextCursor);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeUndefined();
    expect(new Set([...first.items, ...second.items].map(goal => goal.conversationId)).size).toBe(105);
  });
});
