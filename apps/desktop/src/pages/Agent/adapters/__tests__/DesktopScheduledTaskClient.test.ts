import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScheduledTask as DesktopScheduledTask } from '@/services/agentInstance/scheduledTaskTypes';
import { createDesktopScheduledTaskClient } from '../DesktopScheduledTaskClient';

const localTask = (id: string, updated: string): DesktopScheduledTask => ({
  id,
  agentInstanceId: 'agent-1',
  agentDefinitionId: 'definition-1',
  name: `Task ${id}`,
  scheduleKind: 'cron',
  schedule: { kind: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' },
  payload: { message: 'wake' },
  enabled: true,
  deleteAfterRun: false,
  consecutiveFailures: 0,
  runCount: 0,
  createdBy: 'test',
  created: updated,
  updated,
  state: 'active',
  executionNodeId: 'local-peer',
  originNodeId: 'local-peer',
  executionRevision: 0,
  occurrenceAttempt: 0,
});

const listLocalPage = vi.fn();
const listProjectionPage = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  window.service = {
    deviceNetwork: {
      getLocalIdentity: vi.fn().mockResolvedValue({ peerId: 'local-peer' }),
      listDevices: vi.fn().mockResolvedValue([]),
      sendRpc: vi.fn(),
      abortOperation: vi.fn().mockResolvedValue(undefined),
      finishOperation: vi.fn().mockResolvedValue(undefined),
    },
    agentInstance: {
      listScheduledTasksPageForAgent: listLocalPage,
      listRemoteScheduledTaskProjectionPageForAgent: listProjectionPage,
      createScheduledTask: vi.fn(),
      updateScheduledTask: vi.fn(),
      deleteScheduledTask: vi.fn(),
      replaceRemoteScheduledTaskProjections: vi.fn(),
      upsertRemoteScheduledTaskProjection: vi.fn(),
      deleteRemoteScheduledTaskProjection: vi.fn(),
      getCronPreviewDates: vi.fn().mockResolvedValue(['2026-08-26T01:00:00.000Z']),
    },
    native: { log: vi.fn().mockResolvedValue(undefined) },
  } as unknown as typeof window.service;
});

describe('DesktopScheduledTaskClient', () => {
  it('advances the bounded local keyset cursor without materializing another page', async () => {
    const first = localTask('task-2', '2026-08-25T02:00:00.000Z');
    const second = localTask('task-1', '2026-08-25T01:00:00.000Z');
    listLocalPage
      .mockResolvedValueOnce({
        items: [first],
        revision: '7',
        next: { updatedAt: first.updated, id: first.id },
      })
      .mockResolvedValueOnce({ items: [second], revision: '7' });
    const client = createDesktopScheduledTaskClient();

    const page1 = await client.listScheduledTasksForAgent('agent-1', { limit: 1 });
    expect(page1.items.map(task => task.id)).toEqual(['task-2']);
    expect(page1).toMatchObject({
      hasMoreAfter: true,
      partial: false,
      sources: [{ executionNodeId: 'local-peer', state: 'online', fromCache: false }],
    });

    const page2 = await client.listScheduledTasksForAgent('agent-1', {
      cursor: page1.nextCursor,
      limit: 1,
    });
    expect(page2.items.map(task => task.id)).toEqual(['task-1']);
    expect(page2.hasMoreAfter).toBe(false);
    expect(listLocalPage.mock.calls[1]?.[0]).toMatchObject({
      after: { updatedAt: first.updated, id: first.id },
      expectedRevision: '7',
      limit: 1,
    });
  });

  it('exposes an offline remote projection as stale provenance and blocks mutation', async () => {
    const projection = { ...localTask('remote-task', '2026-08-25T02:00:00.000Z'), executionNodeId: 'remote-peer' };
    vi.mocked(window.service.deviceNetwork.listDevices).mockResolvedValue([{
      peerId: 'remote-peer',
      displayName: 'Remote',
      platform: 'desktop',
      trustMode: 'local-pairing',
      trusted: true,
      reachability: { state: 'offline', paths: [] },
      capabilities: { tools: [], mcpServers: [], hasWiki: false, agentLoop: true, imChannels: [], wikis: [] },
    }]);
    listProjectionPage.mockResolvedValue({ items: [{ task: projection, observedAt: 1 }], revision: '3' });
    const client = createDesktopScheduledTaskClient();

    const localPage = await client.listScheduledTasksForAgent('agent-1', { executionNodeIds: ['remote-peer'] });
    expect(localPage).toMatchObject({
      partial: true,
      hasMoreAfter: false,
      sources: [{ executionNodeId: 'remote-peer', state: 'offline', fromCache: true }],
    });
    expect(localPage.items[0]?.executionNodeId).toBe('remote-peer');
    await expect(client.deleteScheduledTask('remote-task')).rejects.toThrow('scheduled_task_live_identity_required');
  });

  it('honours an already-aborted request before any IPC read', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = createDesktopScheduledTaskClient();

    await expect(client.listScheduledTasksForAgent('agent-1', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(listLocalPage).not.toHaveBeenCalled();
  });
});
