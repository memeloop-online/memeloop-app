import type { ScheduledTask as DesktopScheduledTask } from '@services/agentInstance/scheduledTaskTypes';
import type { Device } from '@services/deviceNetwork/interface';
import { type ListScheduledTasksOptions, type ScheduledTask, type ScheduledTaskClient, type ScheduledTaskPage, type ScheduledTaskState } from 'memeloop';
import { createAgentDeviceRpcClient, createScheduledTaskClientFromRpc } from 'memeloop/device-network';

const DEFAULT_LIMIT = 64;
const MAX_LIMIT = 100;
const DEFAULT_MAX_BYTES = 256 * 1024;
const MAX_MAX_BYTES = 256 * 1024;
const MAX_SOURCES = 64;
const MAX_CURSOR_CHARACTERS = 2_048;

interface PagePosition {
  updatedAt: string;
  id: string;
}

interface CachePosition {
  observedAt: number;
  id: string;
}

interface HostCursor {
  version: 1;
  signature: string;
  sourceIndex: number;
  sourceCursor?: string;
  localAfter?: PagePosition;
  cacheAfter?: CachePosition;
  revision?: string;
}

type HostTask = DesktopScheduledTask;

interface SourceTarget {
  executionNodeId: string;
  path: 'local' | 'live' | 'cache';
}

const toCoreTask = (task: HostTask): ScheduledTask => ({
  id: task.id,
  agentInstanceId: task.agentInstanceId,
  agentDefinitionId: task.agentDefinitionId,
  name: task.name,
  schedule: task.schedule,
  ...(task.payload === undefined ? {} : { payload: task.payload }),
  ...(task.activeHoursStart === undefined ? {} : { activeHoursStart: task.activeHoursStart }),
  ...(task.activeHoursEnd === undefined ? {} : { activeHoursEnd: task.activeHoursEnd }),
  enabled: task.enabled,
  ...(task.createdBy === undefined ? {} : { createdBy: task.createdBy }),
  state: task.state,
  executionNodeId: task.executionNodeId,
  ...(task.executionNodeLabel === undefined ? {} : { executionNodeLabel: task.executionNodeLabel }),
  originNodeId: task.originNodeId,
  updatedAt: task.updated,
  executionRevision: task.executionRevision,
  ...(task.occurrenceId === undefined ? {} : { occurrenceId: task.occurrenceId }),
  ...(task.occurrenceScheduledFor === undefined ? {} : { occurrenceScheduledFor: task.occurrenceScheduledFor }),
  occurrenceAttempt: task.occurrenceAttempt,
});

const toHostTask = (task: ScheduledTask): HostTask => ({
  id: task.id,
  agentInstanceId: task.agentInstanceId,
  agentDefinitionId: task.agentDefinitionId,
  name: task.name,
  scheduleKind: task.schedule.kind,
  schedule: task.schedule,
  ...(task.payload?.message === undefined ? {} : { payload: { message: task.payload.message } }),
  enabled: task.enabled,
  deleteAfterRun: false,
  ...(task.activeHoursStart === undefined ? {} : { activeHoursStart: task.activeHoursStart }),
  ...(task.activeHoursEnd === undefined ? {} : { activeHoursEnd: task.activeHoursEnd }),
  consecutiveFailures: 0,
  runCount: 0,
  createdBy: task.createdBy ?? 'remote-device',
  created: task.updatedAt ?? new Date(0).toISOString(),
  updated: task.updatedAt ?? new Date(0).toISOString(),
  state: task.state,
  executionNodeId: task.executionNodeId,
  ...(task.executionNodeLabel === undefined ? {} : { executionNodeLabel: task.executionNodeLabel }),
  originNodeId: task.originNodeId,
  executionRevision: task.executionRevision ?? 0,
  ...(task.occurrenceId === undefined ? {} : { occurrenceId: task.occurrenceId }),
  ...(task.occurrenceScheduledFor === undefined ? {} : { occurrenceScheduledFor: task.occurrenceScheduledFor }),
  occurrenceAttempt: task.occurrenceAttempt ?? 0,
});

interface SourceResult {
  items: ScheduledTask[];
  done: boolean;
  sourceCursor?: string;
  localAfter?: PagePosition;
  cacheAfter?: CachePosition;
  revision?: string;
  partial: boolean;
  fromCache: boolean;
  sourceState: 'online' | 'offline' | 'degraded';
}

/**
 * Electron binding for Core's portable scheduling controller.
 *
 * The host cursor advances one bounded source at a time. This keeps IPC and
 * memory bounded independently of directory size, while the shared controller
 * decides how many pages it is willing to retain. Live remote reads populate a
 * durable projection; offline reads expose that cache with explicit provenance.
 */
export function createDesktopScheduledTaskClient(): ScheduledTaskClient {
  const taskTarget = new Map<string, string>();
  const staleTasks = new Set<string>();
  const remoteClients = new Map<string, ScheduledTaskClient>();
  let configurationSignature: string | undefined;
  let configurationGeneration = 0;

  const reconcileConfiguration = (signature: string): number => {
    if (configurationSignature === undefined) configurationSignature = signature;
    else if (configurationSignature !== signature) {
      configurationSignature = signature;
      configurationGeneration += 1;
      taskTarget.clear();
      staleTasks.clear();
      remoteClients.clear();
    }
    return configurationGeneration;
  };

  const remember = (task: ScheduledTask, stale = false): ScheduledTask => {
    const previous = taskTarget.get(task.id);
    if (previous !== undefined && previous !== task.executionNodeId) {
      throw new Error('scheduled_task_ambiguous_identity');
    }
    taskTarget.set(task.id, task.executionNodeId);
    if (stale) staleTasks.add(task.id);
    else staleTasks.delete(task.id);
    return task;
  };

  const remoteClient = async (executionNodeId: string): Promise<ScheduledTaskClient> => {
    const identity = await window.service.deviceNetwork.getLocalIdentity();
    if (identity.peerId === executionNodeId) throw new Error('scheduled_task_remote_target_is_local');
    const cacheKey = `${identity.peerId}\0${executionNodeId}`;
    const cached = remoteClients.get(cacheKey);
    if (cached) return cached;
    const rpc = createAgentDeviceRpcClient({
      peerId: executionNodeId,
      sendRpc: (peerId, method, parameters, options) => sendRemoteRpc(peerId, method, parameters, options?.signal),
    });
    const client = createScheduledTaskClientFromRpc({
      rpc: rpc.scheduledTasks,
      executionNodeId,
      originNodeId: identity.peerId,
    });
    remoteClients.set(cacheKey, client);
    return client;
  };

  return {
    async listScheduledTasksForAgent(
      agentInstanceId: string,
      options: ListScheduledTasksOptions = {},
    ): Promise<ScheduledTaskPage> {
      options.signal?.throwIfAborted();
      const limit = normalizeLimit(options.limit);
      const maxBytes = normalizeMaxBytes(options.maxBytes);
      const states = normalizeStates(options.states);
      const executionNodeIds = normalizeExecutionNodeIds(options.executionNodeIds);
      const [identity, devices] = await Promise.all([
        window.service.deviceNetwork.getLocalIdentity(),
        window.service.deviceNetwork.listDevices(),
      ]);
      options.signal?.throwIfAborted();
      const allTargets = buildTargets(identity.peerId, devices, executionNodeIds);
      const targets = allTargets.slice(0, MAX_SOURCES);
      const signature = targets.map(target => `${target.executionNodeId}:${target.path}`).join('|');
      const generation = reconcileConfiguration(signature);
      const cursor = options.cursor === undefined
        ? { version: 1, signature, sourceIndex: 0 } satisfies HostCursor
        : decodeCursor(options.cursor, signature, targets.length);
      const target = targets[cursor.sourceIndex];
      if (!target) {
        return { items: [], hasMoreAfter: false, partial: false, sources: [] };
      }

      const result: SourceResult = target.path === 'local'
        ? await readLocalSource({ target, cursor, agentInstanceId, states, limit, options })
        : await readRemoteSource({ target, cursor, agentInstanceId, states, limit, maxBytes, options, remoteClient });
      options.signal?.throwIfAborted();
      if (generation !== configurationGeneration) throw new Error('scheduled_task_configuration_changed');
      const items = result.items.map(task => remember(task, result.fromCache));
      const nextSourceIndex = result.done ? cursor.sourceIndex + 1 : cursor.sourceIndex;
      const hasMoreAfter = !result.done || nextSourceIndex < targets.length;
      const nextCursor = hasMoreAfter
        ? encodeCursor({
          version: 1,
          signature,
          sourceIndex: nextSourceIndex,
          ...(!result.done && result.sourceCursor ? { sourceCursor: result.sourceCursor } : {}),
          ...(!result.done && result.localAfter ? { localAfter: result.localAfter } : {}),
          ...(!result.done && result.cacheAfter ? { cacheAfter: result.cacheAfter } : {}),
          ...(!result.done && result.revision ? { revision: result.revision } : {}),
        })
        : undefined;
      const page: ScheduledTaskPage = {
        items,
        ...(nextCursor === undefined ? {} : { nextCursor }),
        hasMoreAfter,
        partial: result.partial || targets.length < allTargets.length,
        sources: [{
          executionNodeId: target.executionNodeId,
          state: result.sourceState,
          fromCache: result.fromCache,
        }],
      };
      if (new TextEncoder().encode(JSON.stringify(page)).byteLength > maxBytes) {
        throw new Error('scheduled_task_page_byte_budget_exceeded');
      }
      return page;
    },

    async createScheduledTask(input, options = {}) {
      options.signal?.throwIfAborted();
      const identity = await window.service.deviceNetwork.getLocalIdentity();
      const task = input.executionNodeId === identity.peerId
        ? toCoreTask(await window.service.agentInstance.createScheduledTask(input))
        : await (await remoteClient(input.executionNodeId)).createScheduledTask(input, options);
      options.signal?.throwIfAborted();
      remember(task);
      if (input.executionNodeId !== identity.peerId) {
        await bestEffortProjection(() => window.service.agentInstance.upsertRemoteScheduledTaskProjection(toHostTask(task), Date.now()));
      }
      return task;
    },

    async updateScheduledTask(id, input, options = {}) {
      options.signal?.throwIfAborted();
      const executionNodeId = taskTarget.get(id);
      if (!executionNodeId || staleTasks.has(id)) throw new Error('scheduled_task_live_identity_required');
      if (input.executionNodeId !== undefined && input.executionNodeId !== executionNodeId) {
        throw new Error('scheduled_task_execution_node_immutable');
      }
      const identity = await window.service.deviceNetwork.getLocalIdentity();
      const task = executionNodeId === identity.peerId
        ? toCoreTask(await window.service.agentInstance.updateScheduledTask({ id, ...input }))
        : await (await remoteClient(executionNodeId)).updateScheduledTask(id, input, options);
      options.signal?.throwIfAborted();
      remember(task);
      if (executionNodeId !== identity.peerId) {
        await bestEffortProjection(() => window.service.agentInstance.upsertRemoteScheduledTaskProjection(toHostTask(task), Date.now()));
      }
      return task;
    },

    async deleteScheduledTask(id, options = {}) {
      options.signal?.throwIfAborted();
      const executionNodeId = taskTarget.get(id);
      if (!executionNodeId || staleTasks.has(id)) throw new Error('scheduled_task_live_identity_required');
      const identity = await window.service.deviceNetwork.getLocalIdentity();
      if (executionNodeId === identity.peerId) await window.service.agentInstance.deleteScheduledTask(id);
      else await (await remoteClient(executionNodeId)).deleteScheduledTask(id, options);
      options.signal?.throwIfAborted();
      taskTarget.delete(id);
      staleTasks.delete(id);
      if (executionNodeId !== identity.peerId) {
        await bestEffortProjection(() => window.service.agentInstance.deleteRemoteScheduledTaskProjection(id, executionNodeId));
      }
    },

    async getCronPreviewDates(expression, timezone, count, options = {}) {
      options.signal?.throwIfAborted();
      const dates = await window.service.agentInstance.getCronPreviewDates(expression, timezone, count);
      options.signal?.throwIfAborted();
      return dates;
    },
  };
}

async function readLocalSource(input: {
  target: SourceTarget;
  cursor: HostCursor;
  agentInstanceId: string;
  states: ScheduledTaskState[];
  limit: number;
  options: ListScheduledTasksOptions;
}) {
  input.options.signal?.throwIfAborted();
  const page = await window.service.agentInstance.listScheduledTasksPageForAgent({
    agentInstanceId: input.agentInstanceId,
    executionNodeId: input.target.executionNodeId,
    states: input.states,
    limit: input.limit,
    ...(input.cursor.localAfter ? { after: input.cursor.localAfter } : {}),
    ...(input.cursor.revision ? { expectedRevision: input.cursor.revision } : {}),
  });
  input.options.signal?.throwIfAborted();
  return {
    items: page.items.map(toCoreTask),
    done: page.next === undefined,
    localAfter: page.next,
    revision: page.revision,
    partial: false,
    fromCache: false,
    sourceState: 'online' as const,
  };
}

async function readRemoteSource(input: {
  target: SourceTarget;
  cursor: HostCursor;
  agentInstanceId: string;
  states: ScheduledTaskState[];
  limit: number;
  maxBytes: number;
  options: ListScheduledTasksOptions;
  remoteClient: (executionNodeId: string) => Promise<ScheduledTaskClient>;
}) {
  if (input.target.path === 'live') {
    try {
      const page = await (await input.remoteClient(input.target.executionNodeId)).listScheduledTasksForAgent(
        input.agentInstanceId,
        {
          states: input.states,
          executionNodeIds: [input.target.executionNodeId],
          ...(input.cursor.sourceCursor ? { cursor: input.cursor.sourceCursor } : {}),
          limit: input.limit,
          maxBytes: input.maxBytes,
          signal: input.options.signal,
        },
      );
      input.options.signal?.throwIfAborted();
      await bestEffortProjection(async () => {
        if (input.cursor.sourceCursor === undefined && !page.hasMoreAfter) {
          await window.service.agentInstance.replaceRemoteScheduledTaskProjections(
            input.agentInstanceId,
            input.target.executionNodeId,
            page.items.map(toHostTask),
            Date.now(),
          );
        } else {
          for (const task of page.items) {
            await window.service.agentInstance.upsertRemoteScheduledTaskProjection(toHostTask(task), Date.now());
          }
        }
      });
      return {
        items: page.items,
        done: !page.hasMoreAfter,
        sourceCursor: page.nextCursor,
        partial: page.partial,
        fromCache: false,
        sourceState: page.partial ? 'degraded' as const : 'online' as const,
      };
    } catch (error) {
      if (input.options.signal?.aborted) throw error;
      // Live and durable-projection cursors are deliberately unrelated. If a
      // live source disappears between pages, finish this source as partial
      // instead of restarting at the cache head and emitting duplicate tasks.
      if (input.cursor.sourceCursor !== undefined) {
        return {
          items: [],
          done: true,
          partial: true,
          fromCache: false,
          sourceState: 'offline' as const,
        };
      }
    }
  }

  const page = await window.service.agentInstance.listRemoteScheduledTaskProjectionPageForAgent({
    agentInstanceId: input.agentInstanceId,
    executionNodeIds: [input.target.executionNodeId],
    states: input.states,
    limit: input.limit,
    ...(input.cursor.cacheAfter ? { after: input.cursor.cacheAfter } : {}),
    ...(input.cursor.revision ? { expectedRevision: input.cursor.revision } : {}),
  });
  input.options.signal?.throwIfAborted();
  return {
    items: page.items.map(item => toCoreTask(item.task)),
    done: page.next === undefined,
    cacheAfter: page.next,
    revision: page.revision,
    partial: true,
    fromCache: page.items.length > 0,
    sourceState: input.target.path === 'live' && page.items.length > 0 ? 'degraded' as const : 'offline' as const,
  };
}

async function sendRemoteRpc<T>(peerId: string, method: string, parameters: unknown, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const operationId = crypto.randomUUID();
  const abort = () => {
    void window.service.deviceNetwork.abortOperation(operationId);
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const sendRpc = window.service.deviceNetwork.sendRpc as unknown as (
      targetPeerId: string,
      targetMethod: string,
      targetParameters: unknown,
      options: { operationId: string },
    ) => Promise<T>;
    const value = await sendRpc(peerId, method, parameters, { operationId });
    signal?.throwIfAborted();
    return value;
  } finally {
    signal?.removeEventListener('abort', abort);
    await window.service.deviceNetwork.finishOperation(operationId).catch(() => undefined);
  }
}

async function bestEffortProjection(write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (error) {
    await window.service.native.log('warn', 'Failed to update remote scheduled task projection', { error }).catch(() => undefined);
  }
}

function buildTargets(localPeerId: string, devices: readonly Device[], requested: readonly string[] | undefined): SourceTarget[] {
  const requestedSet = requested ? new Set(requested) : undefined;
  const targets: SourceTarget[] = [];
  if (!requestedSet || requestedSet.has(localPeerId)) targets.push({ executionNodeId: localPeerId, path: 'local' });
  const seen = new Set(targets.map(target => target.executionNodeId));
  for (const device of [...devices].sort((left, right) => left.peerId.localeCompare(right.peerId))) {
    if (seen.has(device.peerId) || (requestedSet && !requestedSet.has(device.peerId))) continue;
    seen.add(device.peerId);
    targets.push({
      executionNodeId: device.peerId,
      path: device.trusted && device.reachability.state !== 'offline' ? 'live' : 'cache',
    });
  }
  for (const nodeId of requestedSet ?? []) {
    if (!seen.has(nodeId)) targets.push({ executionNodeId: nodeId, path: 'cache' });
  }
  return targets;
}

function normalizeLimit(limit = DEFAULT_LIMIT): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error('scheduled_task_invalid_page_limit');
  return limit;
}

function normalizeMaxBytes(maxBytes = DEFAULT_MAX_BYTES): number {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 64 || maxBytes > MAX_MAX_BYTES) throw new Error('scheduled_task_invalid_byte_budget');
  return maxBytes;
}

function normalizeStates(states: readonly ScheduledTaskState[] | undefined): ScheduledTaskState[] {
  const defaults: ScheduledTaskState[] = ['active', 'paused'];
  const values: ScheduledTaskState[] = [...(states?.length ? states : defaults)].sort();
  const allowed = new Set<ScheduledTaskState>(['active', 'paused', 'completed', 'cancelled', 'archived']);
  if (new Set(values).size !== values.length || values.some(value => !allowed.has(value))) {
    throw new Error('scheduled_task_invalid_states');
  }
  return values;
}

function normalizeExecutionNodeIds(nodeIds: readonly string[] | undefined): string[] | undefined {
  if (nodeIds === undefined) return undefined;
  const values = [...nodeIds].sort();
  if (values.length > MAX_SOURCES || new Set(values).size !== values.length || values.some(value => !value)) {
    throw new Error('scheduled_task_invalid_execution_nodes');
  }
  return values;
}

function encodeCursor(cursor: HostCursor): string {
  const value = JSON.stringify(cursor);
  if (value.length > MAX_CURSOR_CHARACTERS) throw new Error('scheduled_task_cursor_too_large');
  return value;
}

function decodeCursor(value: string, signature: string, sourceCount: number): HostCursor {
  if (value.length > MAX_CURSOR_CHARACTERS) throw new Error('scheduled_task_invalid_cursor');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('scheduled_task_invalid_cursor');
  }
  const cursor = parsed as Partial<HostCursor>;
  if (
    !cursor || cursor.version !== 1 || cursor.signature !== signature ||
    !Number.isSafeInteger(cursor.sourceIndex) || cursor.sourceIndex! < 0 || cursor.sourceIndex! > sourceCount ||
    (cursor.sourceCursor !== undefined && (typeof cursor.sourceCursor !== 'string' || cursor.sourceCursor.length < 1 || cursor.sourceCursor.length > 1_024)) ||
    (cursor.revision !== undefined && (typeof cursor.revision !== 'string' || cursor.revision.length < 1 || cursor.revision.length > 256)) ||
    (cursor.localAfter !== undefined && !isValidPagePosition(cursor.localAfter)) ||
    (cursor.cacheAfter !== undefined && !isValidCachePosition(cursor.cacheAfter))
  ) throw new Error('scheduled_task_cursor_stale');
  return cursor as HostCursor;
}

function isValidPagePosition(value: unknown): value is PagePosition {
  if (!value || typeof value !== 'object') return false;
  const position = value as Partial<PagePosition>;
  return typeof position.updatedAt === 'string' && position.updatedAt.length <= 64 &&
    !Number.isNaN(Date.parse(position.updatedAt)) &&
    typeof position.id === 'string' && position.id.length > 0 && position.id.length <= 512;
}

function isValidCachePosition(value: unknown): value is CachePosition {
  if (!value || typeof value !== 'object') return false;
  const position = value as Partial<CachePosition>;
  return Number.isSafeInteger(position.observedAt) && position.observedAt! >= 0 &&
    typeof position.id === 'string' && position.id.length > 0 && position.id.length <= 512;
}
