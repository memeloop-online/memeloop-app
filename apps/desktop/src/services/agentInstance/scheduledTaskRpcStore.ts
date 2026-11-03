import {
  createScheduledTaskAggregatePageController,
  createScheduledTaskRpcHandler,
  normalizeScheduledTaskAggregateStates,
  type ScheduledAgentTaskStore,
  type ScheduledTask,
  ScheduledTaskAggregateCursorError,
  type ScheduledTaskAggregateCursorSource,
  type ScheduledTaskRpcCreateInput,
  type ScheduledTaskRpcHandlerInput,
  type ScheduledTaskRpcListRequest,
  type ScheduledTaskRpcListResponse,
  type ScheduledTaskRpcScopedTaskRequest,
  type ScheduledTaskRpcStoreContext,
  type ScheduledTaskRpcUpdateRequest,
} from 'memeloop';
import type { IAgentInstanceService } from './interface';

/** Narrow port consumed by the Core RPC handler; the worker bridge need not
 * pretend to implement unrelated renderer/service methods. */
export type ScheduledTaskServicePort = Pick<
  IAgentInstanceService,
  | 'getScheduledTaskByScope'
  | 'listScheduledTasksPageForAgent'
  | 'createScheduledTask'
  | 'updateScheduledTaskScoped'
  | 'deleteScheduledTaskScoped'
  | 'getCronPreviewDates'
>;

const MAX_LIST_BYTES = 256 * 1024;
const MAX_STORAGE_SCAN_ROWS = 4;

/**
 * Main-process binding for Core's strict, scoped schedule RPC contract.
 * All tuple checks happen before writes, and the caller-supplied origin is
 * replaced with the authenticated remote PeerId.
 */
export function createDesktopScheduledTaskRpcHandler(
  agentInstanceService: ScheduledTaskServicePort,
  localPeerId: string,
): (input: ScheduledTaskRpcHandlerInput) => Promise<unknown> {
  return createScheduledTaskRpcHandler({
    localPeerId,
    store: createDesktopScheduledTaskStore(agentInstanceService),
    cronPreviewer: {
      preview: ({ expression, timezone, count }, context) => {
        context.signal?.throwIfAborted();
        return agentInstanceService.getCronPreviewDates(expression, timezone, count);
      },
    },
  });
}

export function createDesktopScheduledTaskStore(
  agentInstanceService: ScheduledTaskServicePort,
): ScheduledAgentTaskStore {
  const findScoped = async (
    request: ScheduledTaskRpcScopedTaskRequest,
    context: ScheduledTaskRpcStoreContext,
  ): Promise<ScheduledTask | undefined> => {
    context.signal?.throwIfAborted();
    const task = await agentInstanceService.getScheduledTaskByScope({
      taskId: request.taskId,
      agentInstanceId: request.agentInstanceId,
      agentDefinitionId: request.agentDefinitionId,
      executionNodeId: request.executionNodeId,
    }, { signal: context.signal });
    context.signal?.throwIfAborted();
    return task;
  };

  return {
    async list(request: ScheduledTaskRpcListRequest, context): Promise<ScheduledTaskRpcListResponse> {
      context.signal?.throwIfAborted();
      const states = normalizeScheduledTaskAggregateStates(request.states);
      const pageController = createScheduledTaskAggregatePageController({
        agentInstanceId: request.agentInstanceId,
        scope: request.executionNodeId,
        states,
        sourceCount: 1,
      });
      const cursor = request.cursor === undefined ? undefined : pageController.decode(request.cursor);
      const sourceCursor = cursor?.sources[0];
      if (
        cursor !== undefined &&
        (cursor.sourceIndex !== 0 || sourceCursor === undefined || sourceCursor.done ||
          sourceCursor.executionNodeId !== request.executionNodeId ||
          sourceCursor.position?.kind !== 'local' || sourceCursor.revision === undefined)
      ) throw new ScheduledTaskAggregateCursorError();
      const limit = request.limit ?? 100;
      if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 64 || request.maxBytes > MAX_LIST_BYTES) {
        throw new Error('scheduled_task_invalid_byte_budget');
      }
      const page = await agentInstanceService.listScheduledTasksPageForAgent({
        agentInstanceId: request.agentInstanceId,
        executionNodeId: request.executionNodeId,
        states,
        // A task payload can approach 32 KiB. Never materialize an entire
        // 100-row page before applying the transport byte budget.
        limit: Math.min(limit, MAX_STORAGE_SCAN_ROWS),
        after: sourceCursor?.position?.kind === 'local'
          ? { updatedAt: sourceCursor.position.updatedAt, id: sourceCursor.position.id }
          : undefined,
        expectedRevision: sourceCursor?.revision,
        signal: context.signal,
      });
      context.signal?.throwIfAborted();
      const mapped = page.items;
      const items: ScheduledTask[] = [];
      let nextCursor: string | undefined;
      const encodeCursor = (after: { updatedAt: string; id: string }): string =>
        pageController.encodePage({
          sourceIndex: 0,
          sources: [
            {
              executionNodeId: request.executionNodeId,
              done: false,
              position: { kind: 'local', ...after },
              revision: page.revision,
            } satisfies ScheduledTaskAggregateCursorSource,
          ],
        });
      for (let index = 0; index < mapped.length; index += 1) {
        const source = page.items[index];
        const mappedTask = mapped[index];
        if (!source || !mappedTask) throw new Error('scheduled_task_page_projection_mismatch');
        const candidateItems = [...items, mappedTask];
        const hasMoreAfter = index + 1 < mapped.length || page.next !== undefined;
        const candidateCursor = hasMoreAfter
          ? encodeCursor({
            updatedAt: source.updatedAt ?? (() => {
              throw new Error('scheduled_task_missing_updated_at');
            })(),
            id: source.id,
          })
          : undefined;
        const candidate = {
          items: candidateItems,
          ...(candidateCursor ? { nextCursor: candidateCursor } : {}),
          hasMoreAfter,
        } satisfies ScheduledTaskRpcListResponse;
        if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > request.maxBytes) break;
        items.push(mappedTask);
        nextCursor = candidateCursor;
      }
      if (mapped.length > 0 && items.length === 0) throw new Error('scheduled_task_page_item_exceeds_byte_budget');
      const hasMoreAfter = items.length < mapped.length || page.next !== undefined;
      if (hasMoreAfter && nextCursor === undefined && page.next !== undefined) {
        nextCursor = encodeCursor(page.next);
      }
      const response = {
        items,
        ...(hasMoreAfter && nextCursor ? { nextCursor } : {}),
        hasMoreAfter,
      } satisfies ScheduledTaskRpcListResponse;
      if (Buffer.byteLength(JSON.stringify(response), 'utf8') > request.maxBytes) {
        throw new Error('scheduled_task_page_exceeds_byte_budget');
      }
      return response;
    },

    async get(request, context): Promise<ScheduledTask | undefined> {
      return await findScoped(request, context);
    },

    async create(input: ScheduledTaskRpcCreateInput, context: ScheduledTaskRpcStoreContext): Promise<ScheduledTask> {
      context.signal?.throwIfAborted();
      const task = await agentInstanceService.createScheduledTask({
        agentInstanceId: input.agentInstanceId,
        agentDefinitionId: input.agentDefinitionId,
        name: input.name,
        scheduleKind: input.schedule.kind,
        schedule: input.schedule,
        payload: input.payload,
        activeHoursStart: input.activeHoursStart,
        activeHoursEnd: input.activeHoursEnd,
        createdBy: input.createdBy,
        enabled: input.enabled,
        executionNodeId: context.localPeerId,
        executionNodeLabel: input.executionNodeLabel,
        originNodeId: context.remotePeerId,
      }, { signal: context.signal });
      context.signal?.throwIfAborted();
      return task;
    },

    async update(request: ScheduledTaskRpcUpdateRequest, context): Promise<ScheduledTask> {
      const patch = request.patch;
      const task = await agentInstanceService.updateScheduledTaskScoped(
        {
          taskId: request.taskId,
          agentInstanceId: request.agentInstanceId,
          agentDefinitionId: request.agentDefinitionId,
          executionNodeId: request.executionNodeId,
        },
        {
          id: request.taskId,
          name: patch.name,
          scheduleKind: patch.schedule?.kind,
          schedule: patch.schedule,
          payload: patch.payload,
          activeHoursStart: patch.activeHoursStart,
          activeHoursEnd: patch.activeHoursEnd,
          enabled: patch.enabled,
          executionNodeLabel: patch.executionNodeLabel,
        },
        { signal: context.signal },
      );
      context.signal?.throwIfAborted();
      return task;
    },

    async delete(request, context): Promise<void> {
      await agentInstanceService.deleteScheduledTaskScoped({
        taskId: request.taskId,
        agentInstanceId: request.agentInstanceId,
        agentDefinitionId: request.agentDefinitionId,
        executionNodeId: request.executionNodeId,
      }, { signal: context.signal });
      context.signal?.throwIfAborted();
    },
  };
}
