import { Cron } from 'croner';
import { type ScheduledTask as CoreScheduledTask, ScheduledTaskExecutionCoordinator, type ScheduledTaskExecutionIdentity, type ScheduledTaskExecutionPatch } from 'memeloop';
import { nanoid } from 'nanoid';
import { In, type Repository } from 'typeorm';

import { ScheduledTaskEntity } from '@services/database/schema/agent';
import { logger } from '@services/libs/log';
import type { IAgentInstanceService } from './interface';
import type {
  CreateScheduledTaskInput,
  ListScheduledTasksOptions,
  ListScheduledTasksPageForAgentInput,
  ScheduledTask,
  ScheduledTaskCallOptions,
  ScheduledTaskPage,
  ScheduledTaskScope,
  UpdateScheduledTaskInput,
} from './scheduledTaskTypes';

export type { CreateScheduledTaskInput, ScheduleConfig, ScheduledTask, ScheduleKind, UpdateScheduledTaskInput } from './scheduledTaskTypes';

let scheduledTaskRepository: Repository<ScheduledTaskEntity> | null = null;
let agentInstanceService: IAgentInstanceService | null = null;
let localIdentityProvider: (() => Promise<{ peerId: string; deviceName?: string }>) | null = null;
let executionCoordinator: ScheduledTaskExecutionCoordinator | null = null;
let volatilePredicate: ((agentInstanceId: string) => Promise<boolean>) | undefined;

export function initScheduledTaskManager(
  repository: Repository<ScheduledTaskEntity>,
  service: IAgentInstanceService,
  identityProvider: () => Promise<{ peerId: string; deviceName?: string }>,
): void {
  executionCoordinator?.stopAll();
  scheduledTaskRepository = repository;
  agentInstanceService = service;
  localIdentityProvider = identityProvider;
  executionCoordinator = null;
  volatilePredicate = undefined;
}

function requireRepository(): Repository<ScheduledTaskEntity> {
  if (!scheduledTaskRepository) throw new Error('ScheduledTaskManager not initialized');
  return scheduledTaskRepository;
}

async function requireLocalIdentity(): Promise<{ peerId: string; deviceName?: string }> {
  if (!localIdentityProvider) throw new Error('scheduled_task_identity_unavailable');
  const identity = await localIdentityProvider().catch((error: unknown) => {
    throw new Error('scheduled_task_identity_unavailable', { cause: error });
  });
  if (!identity.peerId) throw new Error('scheduled_task_identity_unavailable');
  return identity;
}

function entityToDto(entity: ScheduledTaskEntity): ScheduledTask {
  return {
    id: entity.id,
    agentInstanceId: entity.agentInstanceId,
    agentDefinitionId: entity.agentDefinitionId,
    name: entity.name,
    scheduleKind: entity.scheduleKind,
    schedule: entity.schedule,
    payload: entity.payload ?? undefined,
    enabled: entity.enabled,
    deleteAfterRun: entity.deleteAfterRun,
    activeHoursStart: entity.activeHoursStart ?? undefined,
    activeHoursEnd: entity.activeHoursEnd ?? undefined,
    lastRunAt: entity.lastRunAt?.toISOString(),
    lastRunStatus: entity.lastRunStatus,
    lastError: entity.lastError ?? undefined,
    lastFailureAt: entity.lastFailureAt?.toISOString(),
    consecutiveFailures: entity.consecutiveFailures,
    nextRetryAt: entity.nextRetryAt?.toISOString(),
    nextRunAt: entity.nextRunAt?.toISOString(),
    runCount: entity.runCount,
    maxRuns: entity.maxRuns,
    createdBy: entity.createdBy,
    created: entity.created?.toISOString() ?? new Date().toISOString(),
    updated: entity.updated?.toISOString() ?? new Date().toISOString(),
    state: entity.state,
    executionNodeId: entity.executionNodeId,
    executionNodeLabel: entity.executionNodeLabel ?? undefined,
    originNodeId: entity.originNodeId,
    executionRevision: entity.executionRevision,
    occurrenceId: entity.occurrenceId ?? undefined,
    occurrenceScheduledFor: entity.occurrenceScheduledFor?.toISOString(),
    occurrenceAttempt: entity.occurrenceAttempt,
  };
}

function toCoreTask(entity: ScheduledTaskEntity): CoreScheduledTask {
  const task = entityToDto(entity);
  return {
    id: task.id,
    agentInstanceId: task.agentInstanceId,
    agentDefinitionId: task.agentDefinitionId,
    name: task.name,
    schedule: task.schedule,
    payload: task.payload,
    activeHoursStart: task.activeHoursStart,
    activeHoursEnd: task.activeHoursEnd,
    enabled: task.enabled,
    createdBy: task.createdBy,
    state: task.state,
    executionNodeId: task.executionNodeId,
    executionNodeLabel: task.executionNodeLabel,
    originNodeId: task.originNodeId,
    executionRevision: task.executionRevision,
    occurrenceId: task.occurrenceId,
    occurrenceScheduledFor: task.occurrenceScheduledFor,
    occurrenceAttempt: task.occurrenceAttempt,
    updatedAt: task.updated,
    nextRunAt: task.nextRunAt,
    lastRunAt: task.lastRunAt,
    lastRunStatus: task.lastRunStatus,
    lastError: task.lastError,
    lastFailureAt: task.lastFailureAt,
    consecutiveFailures: task.consecutiveFailures,
    nextRetryAt: task.nextRetryAt,
    runCount: task.runCount,
    maxRuns: task.maxRuns,
    deleteAfterRun: task.deleteAfterRun,
  };
}

interface RestoreCursor {
  version: 1;
  revision: string;
  after: { updatedAt: string; id: string };
}

function encodeRestoreCursor(revision: string, after: RestoreCursor['after']): string {
  return Buffer.from(JSON.stringify({ version: 1, revision, after } satisfies RestoreCursor)).toString('base64url');
}

function decodeRestoreCursor(value: string | undefined): RestoreCursor | undefined {
  if (value === undefined) return undefined;
  if (value.length < 1 || value.length > 2_048 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('scheduled_task_invalid_restore_cursor');
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch (error) {
    throw new Error('scheduled_task_invalid_restore_cursor', { cause: error });
  }
  if (
    !decoded ||
    typeof decoded !== 'object' ||
    Array.isArray(decoded) ||
    (decoded as RestoreCursor).version !== 1 ||
    typeof (decoded as RestoreCursor).revision !== 'string' ||
    !(decoded as RestoreCursor).after ||
    typeof (decoded as RestoreCursor).after.updatedAt !== 'string' ||
    !Number.isFinite(new Date((decoded as RestoreCursor).after.updatedAt).getTime()) ||
    typeof (decoded as RestoreCursor).after.id !== 'string' ||
    !(decoded as RestoreCursor).after.id
  ) throw new Error('scheduled_task_invalid_restore_cursor');
  return decoded as RestoreCursor;
}

async function ensureExecutionCoordinator(): Promise<ScheduledTaskExecutionCoordinator> {
  if (executionCoordinator) return executionCoordinator;
  const identity = await requireLocalIdentity();
  const service = agentInstanceService;
  if (!service) throw new Error('ScheduledTaskManager not initialized');
  executionCoordinator = new ScheduledTaskExecutionCoordinator({
    localPeerId: identity.peerId,
    store: {
      async listRunnablePage(options) {
        options.signal?.throwIfAborted();
        const cursor = decodeRestoreCursor(options.cursor);
        const page = await getScheduledTasksPageForAgent({
          agentInstanceId: '%',
          executionNodeId: options.executionNodeId,
          states: ['active'],
          limit: options.limit,
          after: cursor?.after,
          expectedRevision: cursor?.revision,
          signal: options.signal,
        }, { allAgents: true });
        const entities = await Promise.all(page.items.map(async task => ({
          task,
          volatile: await volatilePredicate?.(task.agentInstanceId) ?? false,
        })));
        const items = entities.filter(item => !item.volatile).map(item => ({
          ...item.task,
          updatedAt: item.task.updated,
        }));
        return {
          items,
          ...(page.next ? { nextCursor: encodeRestoreCursor(page.revision, page.next) } : {}),
          hasMoreAfter: page.next !== undefined,
        };
      },
      updateExecution: updateExecutionProjection,
    },
    async runAgent(input) {
      input.signal.throwIfAborted();
      await service.runScheduledTaskAgent(input.conversationId, input.message, {
        occurrenceId: input.occurrenceId,
        scheduledFor: input.scheduledFor,
        attempt: input.attempt,
        signal: input.signal,
      });
    },
    onError(error) {
      logger.error('Scheduled task coordinator failure', { error });
    },
  });
  return executionCoordinator;
}

async function updateExecutionProjection(
  identity: ScheduledTaskExecutionIdentity,
  patch: ScheduledTaskExecutionPatch,
  options: { expectedExecutionRevision: number; signal?: AbortSignal },
): Promise<CoreScheduledTask | null> {
  const repository = requireRepository();
  options.signal?.throwIfAborted();
  return repository.manager.transaction(async manager => {
    const transactionRepository = manager.getRepository(ScheduledTaskEntity);
    const where = scopeWhere({
      taskId: identity.taskId,
      agentInstanceId: identity.agentInstanceId,
      agentDefinitionId: identity.agentDefinitionId,
      executionNodeId: identity.executionNodeId,
    });
    const fields: Record<string, unknown> = {
      executionRevision: options.expectedExecutionRevision + 1,
      updated: new Date(patch.updatedAt),
    };
    if (patch.state !== undefined) fields.state = patch.state;
    if (patch.enabled !== undefined) fields.enabled = patch.enabled;
    if (Object.hasOwn(patch, 'nextRunAt')) fields.nextRunAt = parseNullableDate(patch.nextRunAt);
    if (patch.lastRunAt !== undefined) fields.lastRunAt = new Date(patch.lastRunAt);
    if (patch.lastRunStatus !== undefined) fields.lastRunStatus = patch.lastRunStatus;
    if (Object.hasOwn(patch, 'lastError')) fields.lastError = patch.lastError ?? null;
    if (Object.hasOwn(patch, 'lastFailureAt')) fields.lastFailureAt = parseNullableDate(patch.lastFailureAt);
    if (patch.consecutiveFailures !== undefined) fields.consecutiveFailures = patch.consecutiveFailures;
    if (Object.hasOwn(patch, 'nextRetryAt')) fields.nextRetryAt = parseNullableDate(patch.nextRetryAt);
    if (patch.runCount !== undefined) fields.runCount = patch.runCount;
    if (Object.hasOwn(patch, 'occurrenceId')) fields.occurrenceId = patch.occurrenceId ?? null;
    if (Object.hasOwn(patch, 'occurrenceScheduledFor')) {
      fields.occurrenceScheduledFor = parseNullableDate(patch.occurrenceScheduledFor);
    }
    if (patch.occurrenceAttempt !== undefined) fields.occurrenceAttempt = patch.occurrenceAttempt;
    const result = await transactionRepository.createQueryBuilder()
      .update(ScheduledTaskEntity)
      .set(fields)
      .where('id = :id', { id: where.id })
      .andWhere('agentInstanceId = :agentInstanceId', { agentInstanceId: where.agentInstanceId })
      .andWhere('agentDefinitionId = :agentDefinitionId', { agentDefinitionId: where.agentDefinitionId })
      .andWhere('executionNodeId = :executionNodeId', { executionNodeId: where.executionNodeId })
      .andWhere('executionRevision = :executionRevision', { executionRevision: options.expectedExecutionRevision })
      .execute();
    options.signal?.throwIfAborted();
    if (result.affected !== 1) return null;
    const saved = await transactionRepository.findOne({
      where: { ...where, executionRevision: options.expectedExecutionRevision + 1 },
    });
    if (!saved) return null;
    options.signal?.throwIfAborted();
    return toCoreTask(saved);
  });
}

function parseNullableDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error('scheduled_task_invalid_execution_timestamp');
  return result;
}

function validateSchedule(
  entity: Pick<ScheduledTaskEntity, 'schedule' | 'scheduleKind' | 'activeHoursStart' | 'activeHoursEnd'>,
): void {
  if (entity.schedule.kind !== entity.scheduleKind) throw new Error('scheduled_task_schedule_kind_mismatch');
  if ((entity.activeHoursStart && !entity.activeHoursEnd) || (!entity.activeHoursStart && entity.activeHoursEnd)) {
    throw new Error('scheduled_task_invalid_active_hours');
  }
  for (const value of [entity.activeHoursStart, entity.activeHoursEnd]) {
    if (!value) continue;
    const match = /^(\d{2}):(\d{2})$/u.exec(value);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
      throw new Error('scheduled_task_invalid_active_hours');
    }
  }
  if (entity.schedule.kind === 'at') {
    const wakeAt = new Date(entity.schedule.wakeAtISO);
    if (!Number.isFinite(wakeAt.getTime())) throw new Error('scheduled_task_invalid_at');
    return;
  }
  if (entity.schedule.timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: entity.schedule.timezone }).format(new Date());
    } catch (error) {
      throw new Error('scheduled_task_invalid_timezone', { cause: error });
    }
  }
  try {
    const cron = new Cron(entity.schedule.expression, {
      paused: true,
      ...(entity.schedule.timezone ? { timezone: entity.schedule.timezone } : {}),
    });
    if (!cron.nextRun()) throw new Error('scheduled_task_has_no_next_occurrence');
    cron.stop();
  } catch (error) {
    throw new Error('scheduled_task_invalid_cron', { cause: error });
  }
}

export async function restoreScheduledTasks(
  repository: Repository<ScheduledTaskEntity>,
  isVolatile: (agentInstanceId: string) => Promise<boolean>,
): Promise<void> {
  if (scheduledTaskRepository !== repository) scheduledTaskRepository = repository;
  volatilePredicate = isVolatile;
  const coordinator = await ensureExecutionCoordinator();
  await coordinator.restore();
}

export async function addTask(
  input: CreateScheduledTaskInput,
  options: ScheduledTaskCallOptions = {},
): Promise<ScheduledTask> {
  const repository = requireRepository();
  options.signal?.throwIfAborted();
  const identity = await requireLocalIdentity();
  const metadata = await agentInstanceService?.getAgentMetadata(input.agentInstanceId);
  options.signal?.throwIfAborted();
  if (!metadata) throw new Error('scheduled_task_agent_unavailable');
  if (metadata.volatile || metadata.isSubAgent) throw new Error('scheduled_task_volatile_agent');
  if (input.agentDefinitionId && input.agentDefinitionId !== metadata.agentDefId) {
    throw new Error('scheduled_task_agent_definition_mismatch');
  }
  const agentDefinitionId = metadata.agentDefId;
  const name = input.name ?? `${metadata.name || input.agentInstanceId} schedule`;
  if (!agentDefinitionId) throw new Error('scheduled_task_definition_unavailable');
  const executionNodeId = input.executionNodeId ?? identity.peerId;
  if (executionNodeId !== identity.peerId) {
    throw new Error(`scheduled_task_wrong_execution_node:${executionNodeId}`);
  }
  const entity = repository.create({
    id: nanoid(),
    agentInstanceId: input.agentInstanceId,
    agentDefinitionId,
    name,
    scheduleKind: input.scheduleKind,
    schedule: input.schedule,
    payload: input.payload ?? null,
    enabled: input.enabled ?? true,
    state: input.state ?? (input.enabled === false ? 'paused' : 'active'),
    executionNodeId,
    executionNodeLabel: input.executionNodeLabel ?? identity.deviceName ?? null,
    originNodeId: input.originNodeId ?? identity.peerId,
    deleteAfterRun: input.deleteAfterRun ?? input.schedule.kind === 'at',
    activeHoursStart: input.activeHoursStart ?? null,
    activeHoursEnd: input.activeHoursEnd ?? null,
    maxRuns: input.maxRuns,
    createdBy: input.createdBy ?? 'settings-ui',
    runCount: 0,
    consecutiveFailures: 0,
    executionRevision: 0,
    occurrenceId: null,
    occurrenceScheduledFor: null,
    occurrenceAttempt: 0,
  });
  validateSchedule(entity);
  const saved = await repository.manager.transaction(async manager => {
    options.signal?.throwIfAborted();
    const result = await manager.getRepository(ScheduledTaskEntity).save(entity);
    options.signal?.throwIfAborted();
    return result;
  });
  await (await ensureExecutionCoordinator()).upsert(toCoreTask(saved), options);
  return entityToDto(saved);
}

function applyUpdate(entity: ScheduledTaskEntity, input: UpdateScheduledTaskInput): ScheduledTaskEntity {
  if (input.schedule !== undefined) {
    entity.schedule = input.schedule;
    entity.scheduleKind = input.schedule.kind;
  }
  if (input.scheduleKind !== undefined && input.scheduleKind !== entity.schedule.kind) {
    throw new Error('scheduled_task_schedule_kind_mismatch');
  }
  if (input.name !== undefined) entity.name = input.name;
  if (Object.hasOwn(input, 'payload')) entity.payload = input.payload ?? null;
  if (input.enabled !== undefined) entity.enabled = input.enabled;
  if (input.state !== undefined) entity.state = input.state;
  else if (input.enabled !== undefined) entity.state = input.enabled ? 'active' : 'paused';
  if (Object.hasOwn(input, 'executionNodeLabel')) entity.executionNodeLabel = input.executionNodeLabel ?? null;
  if (input.deleteAfterRun !== undefined) entity.deleteAfterRun = input.deleteAfterRun;
  if (Object.hasOwn(input, 'activeHoursStart')) entity.activeHoursStart = input.activeHoursStart ?? null;
  if (Object.hasOwn(input, 'activeHoursEnd')) entity.activeHoursEnd = input.activeHoursEnd ?? null;
  if (input.maxRuns !== undefined) entity.maxRuns = input.maxRuns;
  validateSchedule(entity);
  return entity;
}

export async function updateTask(input: UpdateScheduledTaskInput): Promise<ScheduledTask> {
  const repository = requireRepository();
  const persisted = await repository.findOne({ where: { id: input.id } });
  if (!persisted) throw new Error(`ScheduledTask not found: ${input.id}`);
  if (input.executionNodeId !== undefined && input.executionNodeId !== persisted.executionNodeId) {
    throw new Error('scheduled_task_execution_node_immutable');
  }
  return updateTaskScoped({
    taskId: persisted.id,
    agentInstanceId: persisted.agentInstanceId,
    agentDefinitionId: persisted.agentDefinitionId,
    executionNodeId: persisted.executionNodeId,
  }, input);
}

export async function updateTaskScoped(
  scope: ScheduledTaskScope,
  input: UpdateScheduledTaskInput,
  options: ScheduledTaskCallOptions = {},
): Promise<ScheduledTask> {
  const repository = requireRepository();
  options.signal?.throwIfAborted();
  const entity = await repository.manager.transaction(async manager => {
    const transactionRepository = manager.getRepository(ScheduledTaskEntity);
    const where = scopeWhere(scope);
    const persisted = await transactionRepository.findOne({ where });
    options.signal?.throwIfAborted();
    if (!persisted) throw new Error('scheduled_task_scope_unavailable');
    // applyUpdate mutates the TypeORM entity. Preserve the revision used by
    // the compare-and-swap predicate before constructing the next value.
    const expectedExecutionRevision = persisted.executionRevision;
    const candidate = applyUpdate(persisted, input);
    candidate.executionRevision = expectedExecutionRevision + 1;
    const result = await transactionRepository.createQueryBuilder()
      .update(ScheduledTaskEntity)
      .set(mutableTaskFields(candidate))
      .where('id = :id', { id: where.id })
      .andWhere('agentInstanceId = :agentInstanceId', { agentInstanceId: where.agentInstanceId })
      .andWhere('agentDefinitionId = :agentDefinitionId', { agentDefinitionId: where.agentDefinitionId })
      .andWhere('executionNodeId = :executionNodeId', { executionNodeId: where.executionNodeId })
      .andWhere('executionRevision = :executionRevision', { executionRevision: expectedExecutionRevision })
      .execute();
    options.signal?.throwIfAborted();
    if (result.affected !== 1) throw new Error('scheduled_task_scope_unavailable');
    const updated = await transactionRepository.findOne({ where });
    if (!updated) throw new Error('scheduled_task_scope_unavailable');
    return updated;
  });
  await (await ensureExecutionCoordinator()).reconcile(toCoreTask(entity), options);
  return entityToDto(entity);
}

export async function getTaskByScope(
  scope: ScheduledTaskScope,
  options: ScheduledTaskCallOptions = {},
): Promise<ScheduledTask | undefined> {
  options.signal?.throwIfAborted();
  const entity = await requireRepository().findOne({ where: scopeWhere(scope) });
  options.signal?.throwIfAborted();
  return entity ? entityToDto(entity) : undefined;
}

export async function removeTaskScoped(
  scope: ScheduledTaskScope,
  options: ScheduledTaskCallOptions = {},
): Promise<void> {
  options.signal?.throwIfAborted();
  const repository = requireRepository();
  const where = scopeWhere(scope);
  const result = await repository.createQueryBuilder()
    .update(ScheduledTaskEntity)
    .set({ enabled: false, state: 'cancelled', executionRevision: () => 'executionRevision + 1' })
    .where('id = :id', { id: where.id })
    .andWhere('agentInstanceId = :agentInstanceId', { agentInstanceId: where.agentInstanceId })
    .andWhere('agentDefinitionId = :agentDefinitionId', { agentDefinitionId: where.agentDefinitionId })
    .andWhere('executionNodeId = :executionNodeId', { executionNodeId: where.executionNodeId })
    .execute();
  options.signal?.throwIfAborted();
  if (result.affected !== 1) throw new Error('scheduled_task_scope_unavailable');
  executionCoordinator?.remove(scope.taskId);
}

export async function removeTask(taskId: string): Promise<void> {
  await requireRepository().createQueryBuilder()
    .update(ScheduledTaskEntity)
    .set({ enabled: false, state: 'cancelled', executionRevision: () => 'executionRevision + 1' })
    .where('id = :id', { id: taskId })
    .execute();
  executionCoordinator?.remove(taskId);
}

function scopeWhere(scope: ScheduledTaskScope): Pick<
  ScheduledTaskEntity,
  'id' | 'agentInstanceId' | 'agentDefinitionId' | 'executionNodeId'
> {
  return {
    id: scope.taskId,
    agentInstanceId: scope.agentInstanceId,
    agentDefinitionId: scope.agentDefinitionId,
    executionNodeId: scope.executionNodeId,
  };
}

function mutableTaskFields(entity: ScheduledTaskEntity): Partial<ScheduledTaskEntity> {
  return {
    name: entity.name,
    scheduleKind: entity.scheduleKind,
    schedule: entity.schedule,
    payload: entity.payload,
    enabled: entity.enabled,
    state: entity.state,
    executionNodeLabel: entity.executionNodeLabel,
    deleteAfterRun: entity.deleteAfterRun,
    activeHoursStart: entity.activeHoursStart,
    activeHoursEnd: entity.activeHoursEnd,
    maxRuns: entity.maxRuns,
    executionRevision: entity.executionRevision,
  };
}

export async function getActiveTasks(options: ListScheduledTasksOptions = {}): Promise<ScheduledTask[]> {
  const states = options.states?.length ? options.states : ['active'];
  return (await requireRepository().find({
    where: {
      state: In(states),
      ...(options.executionNodeIds?.length ? { executionNodeId: In(options.executionNodeIds) } : {}),
    },
    order: { updated: 'DESC', id: 'DESC' },
  })).map(entityToDto);
}

export async function getActiveTasksForAgent(
  agentInstanceId: string,
  options: ListScheduledTasksOptions = {},
): Promise<ScheduledTask[]> {
  const states = options.states?.length ? options.states : ['active'];
  return (await requireRepository().find({
    where: {
      agentInstanceId,
      state: In(states),
      ...(options.executionNodeIds?.length ? { executionNodeId: In(options.executionNodeIds) } : {}),
    },
    order: { updated: 'DESC', id: 'DESC' },
  })).map(entityToDto);
}

export async function getScheduledTasksPageForAgent(
  input: ListScheduledTasksPageForAgentInput,
  internal: { allAgents?: boolean } = {},
): Promise<ScheduledTaskPage> {
  const repository = requireRepository();
  input.signal?.throwIfAborted();
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new Error('scheduled_task_invalid_page_limit');
  }
  if (input.states.length < 1 || input.states.length > 5 || new Set(input.states).size !== input.states.length) {
    throw new Error('scheduled_task_invalid_states');
  }
  if (input.after && (!input.after.id || !Number.isFinite(new Date(input.after.updatedAt).getTime()))) {
    throw new Error('scheduled_task_invalid_cursor');
  }
  await ensureScheduledTaskRevisionSchema(repository);
  input.signal?.throwIfAborted();
  return repository.manager.transaction(async manager => {
    const revisionRows = await manager.query<Array<{ revision?: number | string }>>(
      'SELECT revision FROM scheduled_task_revision WHERE id = 1',
    );
    input.signal?.throwIfAborted();
    const revision = String(revisionRows[0]?.revision ?? 0);
    if (input.expectedRevision !== undefined && input.expectedRevision !== revision) {
      throw new Error('scheduled_task_cursor_stale');
    }
    const query = manager.getRepository(ScheduledTaskEntity).createQueryBuilder('task')
      .where('task.executionNodeId = :executionNodeId', { executionNodeId: input.executionNodeId })
      .andWhere('task.state IN (:...states)', { states: input.states })
      .orderBy('task.updated', 'DESC')
      .addOrderBy('task.id', 'DESC')
      .take(input.limit + 1);
    if (!internal.allAgents) {
      query.andWhere('task.agentInstanceId = :agentInstanceId', { agentInstanceId: input.agentInstanceId });
    }
    if (input.after) {
      query.andWhere(
        '(task.updated < :afterUpdated OR (task.updated = :afterUpdated AND task.id < :afterId))',
        { afterUpdated: new Date(input.after.updatedAt), afterId: input.after.id },
      );
    }
    const rows = await query.getMany();
    input.signal?.throwIfAborted();
    const hasMore = rows.length > input.limit;
    const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(entityToDto),
      revision,
      ...(hasMore && last ? { next: { updatedAt: last.updated.toISOString(), id: last.id } } : {}),
    };
  });
}

const revisionSchemaManagers = new WeakSet<object>();

async function ensureScheduledTaskRevisionSchema(repository: Repository<ScheduledTaskEntity>): Promise<void> {
  const manager = repository.manager;
  if (revisionSchemaManagers.has(manager)) return;
  await manager.query(
    'CREATE TABLE IF NOT EXISTS scheduled_task_revision (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL)',
  );
  await manager.query('INSERT OR IGNORE INTO scheduled_task_revision (id, revision) VALUES (1, 0)');
  for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
    await manager.query(
      `CREATE TRIGGER IF NOT EXISTS scheduled_task_revision_${operation.toLowerCase()} AFTER ${operation} ON scheduled_tasks BEGIN UPDATE scheduled_task_revision SET revision = revision + 1 WHERE id = 1; END`,
    );
  }
  revisionSchemaManagers.add(manager);
}

export function stopAllScheduledTasks(): void {
  executionCoordinator?.stopAll();
  executionCoordinator = null;
}

export function getCronPreviewDates(expression: string, timezone?: string, count = 3): string[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > 10) return [];
  try {
    const dates: string[] = [];
    const cron = new Cron(expression, {
      paused: true,
      maxRuns: count,
      ...(timezone ? { timezone } : {}),
    });
    let next = cron.nextRun();
    while (next && dates.length < count) {
      dates.push(next.toISOString());
      next = cron.nextRun(next);
    }
    cron.stop();
    return dates;
  } catch {
    return [];
  }
}

export async function cancelTasksForAgent(agentInstanceId: string): Promise<void> {
  const repository = requireRepository();
  const tasks = await repository.find({
    select: { id: true },
    where: { agentInstanceId, state: 'active' },
  });
  await repository.createQueryBuilder()
    .update(ScheduledTaskEntity)
    .set({ enabled: false, state: 'cancelled', executionRevision: () => 'executionRevision + 1' })
    .where('agentInstanceId = :agentInstanceId', { agentInstanceId })
    .andWhere('state = :state', { state: 'active' })
    .execute();
  for (const task of tasks) executionCoordinator?.remove(task.id);
}

/**
 * Permanently remove schedule rows before deleting their owning Agent. There is
 * intentionally no FK cascade because projections are independently durable.
 */
export async function deleteTasksForAgent(agentInstanceId: string): Promise<void> {
  const repository = requireRepository();
  const tasks = await repository.find({
    select: { id: true },
    where: { agentInstanceId },
  });
  for (const task of tasks) executionCoordinator?.remove(task.id);
  await repository.delete({ agentInstanceId });
}
