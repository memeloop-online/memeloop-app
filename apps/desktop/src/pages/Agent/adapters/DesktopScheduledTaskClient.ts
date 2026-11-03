import type { Device } from '@services/deviceNetwork/interface';
import {
  createScheduledTaskAggregatePageController,
  type ListScheduledTasksOptions,
  normalizeScheduledTaskAggregateStates,
  type ScheduledTask,
  type ScheduledTaskAggregateCursorSource,
  type ScheduledTaskClient,
  type ScheduledTaskPage,
  type ScheduledTaskState,
} from 'memeloop';
import { createAgentDeviceRpcClient, createScheduledTaskClientFromRpc } from 'memeloop/device-network';

const DEFAULT_LIMIT = 64;
const MAX_LIMIT = 100;
const DEFAULT_MAX_BYTES = 256 * 1024;
const MAX_MAX_BYTES = 256 * 1024;
const MAX_SOURCES = 64;

interface PagePosition {
  updatedAt: string;
  id: string;
}

interface CachePosition {
  observedAt: number;
  id: string;
}

interface SourceTarget {
  executionNodeId: string;
  path: 'local' | 'live' | 'cache';
}

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
      if (targets.length === 0) {
        return { items: [], hasMoreAfter: false, partial: false, sources: [] };
      }
      const signature = targetSignature(identity.peerId, targets);
      const generation = reconcileConfiguration(signature);
      const pageController = createScheduledTaskAggregatePageController({
        agentInstanceId,
        scope: signature,
        states,
        sourceCount: targets.length,
      });
      const cursor = options.cursor === undefined
        ? pageController.initial()
        : pageController.decode(options.cursor);
      const target = targets[cursor.sourceIndex];
      if (!target) {
        return { items: [], hasMoreAfter: false, partial: false, sources: [] };
      }
      if (
        cursor.sources.length > 1 ||
        cursor.sources[0] !== undefined && cursor.sources[0].executionNodeId !== target.executionNodeId
      ) throw new Error('scheduled_task_cursor_source_mismatch');
      const source = cursor.sources[0];

      const result: SourceResult = target.path === 'local'
        ? await readLocalSource({ target, source, agentInstanceId, states, limit, options })
        : await readRemoteSource({ target, source, agentInstanceId, states, limit, maxBytes, options, remoteClient });
      options.signal?.throwIfAborted();
      if (generation !== configurationGeneration) throw new Error('scheduled_task_configuration_changed');
      const items = result.items.map(task => remember(task, result.fromCache));
      const nextSourceIndex = result.done ? cursor.sourceIndex + 1 : cursor.sourceIndex;
      const hasMoreAfter = !result.done || nextSourceIndex < targets.length;
      const nextCursor = hasMoreAfter
        ? pageController.encodePage({
          sourceIndex: nextSourceIndex,
          sources: result.done ? [] : [{
            executionNodeId: target.executionNodeId,
            done: false,
            ...(result.sourceCursor ? { cursor: result.sourceCursor } : {}),
            ...(result.localAfter ? { position: { kind: 'local', ...result.localAfter } } : {}),
            ...(result.cacheAfter ? { position: { kind: 'cache', ...result.cacheAfter } } : {}),
            ...(result.revision ? { revision: result.revision } : {}),
          }],
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
        ? await window.service.agentInstance.createScheduledTask(input)
        : await (await remoteClient(input.executionNodeId)).createScheduledTask(input, options);
      options.signal?.throwIfAborted();
      remember(task);
      if (input.executionNodeId !== identity.peerId) {
        await bestEffortProjection(() => window.service.agentInstance.upsertRemoteScheduledTaskProjection(task, Date.now()));
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
        ? await window.service.agentInstance.updateScheduledTask({ id, ...input })
        : await (await remoteClient(executionNodeId)).updateScheduledTask(id, input, options);
      options.signal?.throwIfAborted();
      remember(task);
      if (executionNodeId !== identity.peerId) {
        await bestEffortProjection(() => window.service.agentInstance.upsertRemoteScheduledTaskProjection(task, Date.now()));
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
  source: ScheduledTaskAggregateCursorSource | undefined;
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
    ...(input.source?.position?.kind === 'local' ? { after: input.source.position } : {}),
    ...(input.source?.revision ? { expectedRevision: input.source.revision } : {}),
  });
  input.options.signal?.throwIfAborted();
  return {
    items: page.items,
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
  source: ScheduledTaskAggregateCursorSource | undefined;
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
          ...(input.source?.cursor ? { cursor: input.source.cursor } : {}),
          limit: input.limit,
          maxBytes: input.maxBytes,
          signal: input.options.signal,
        },
      );
      input.options.signal?.throwIfAborted();
      await bestEffortProjection(async () => {
        if (input.source?.cursor === undefined && !page.hasMoreAfter) {
          await window.service.agentInstance.replaceRemoteScheduledTaskProjections(
            input.agentInstanceId,
            input.target.executionNodeId,
            page.items,
            Date.now(),
          );
        } else {
          for (const task of page.items) {
            await window.service.agentInstance.upsertRemoteScheduledTaskProjection(task, Date.now());
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
      if (input.source?.cursor !== undefined) {
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
    ...(input.source?.position?.kind === 'cache' ? { after: input.source.position } : {}),
    ...(input.source?.revision ? { expectedRevision: input.source.revision } : {}),
  });
  input.options.signal?.throwIfAborted();
  return {
    items: page.items.map(item => item.task),
    done: page.next === undefined,
    cacheAfter: page.next,
    revision: page.revision,
    partial: true,
    fromCache: page.items.length > 0,
    sourceState: input.target.path === 'live' && page.items.length > 0 ? 'degraded' as const : 'offline' as const,
  };
}

async function sendRemoteRpc(peerId: string, method: string, parameters: unknown, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  const operationId = crypto.randomUUID();
  const abort = () => {
    void window.service.deviceNetwork.abortOperation(operationId);
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const value = await window.service.deviceNetwork.sendRpcForOperation(peerId, method, parameters, { operationId });
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
  return normalizeScheduledTaskAggregateStates(states);
}

function normalizeExecutionNodeIds(nodeIds: readonly string[] | undefined): string[] | undefined {
  if (nodeIds === undefined) return undefined;
  const values = [...nodeIds].sort();
  if (
    values.length > MAX_SOURCES ||
    new Set(values).size !== values.length ||
    values.some(value => !value || value.length > 512)
  ) {
    throw new Error('scheduled_task_invalid_execution_nodes');
  }
  return values;
}

/** Keep the Core cursor scope bounded even when the trusted device directory is large. */
function targetSignature(localPeerId: string, targets: readonly SourceTarget[]): string {
  const input = [localPeerId, ...targets.map(target => `${target.executionNodeId}:${target.path}`)].join('\n');
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `v1-${targets.length}-${first.toString(16)}-${second.toString(16)}`;
}
