/**
 * Scheduled-task tools for agent self-wake and recurring work.
 *
 * Scheduling is owned by the canonical ScheduledTask manager.  This module is
 * only the LLM-facing tool adapter; it must not create process-local timers or
 * persist a second scheduling record.
 */
import { t } from '@services/libs/i18n/placeholder';
import type { ToolDefinition } from 'memeloop/tools';
import { z } from 'zod/v4';

import type { ScheduleConfig } from '../scheduledTaskTypes';

export const ScheduledTaskToolParameterSchema = z.object({
  toolListPosition: z.object({
    targetId: z.string().meta({ title: t('Schema.Common.ToolListPosition.TargetIdTitle'), description: t('Schema.Common.ToolListPosition.TargetId') }),
    position: z.enum(['before', 'after']).meta({ title: t('Schema.Common.ToolListPosition.PositionTitle'), description: t('Schema.Common.ToolListPosition.Position') }),
  }).optional().meta({ title: t('Schema.Common.ToolListPositionTitle'), description: t('Schema.Common.ToolListPosition.Description') }),
}).meta({ title: 'Scheduled Tasks Config', description: 'Configuration for the scheduled-task tools' });

export type ScheduledTaskToolParameter = z.infer<typeof ScheduledTaskToolParameterSchema>;

// ─── schedule-task / list-schedules / remove-schedule / update-schedule ──────

const ScheduleTaskToolSchema = z.object({
  kind: z.enum(['at', 'cron']).meta({
    title: 'Schedule kind',
    description: '"at" (one-shot ISO datetime) or "cron" (recurring cron expression)',
  }),
  wakeAtISO: z.string().optional().meta({
    title: 'Wake time (ISO 8601)',
    description: 'Required when kind="at". The datetime to wake at.',
  }),
  cronExpression: z.string().optional().meta({
    title: 'Cron expression',
    description: 'Required when kind="cron". 5-field cron: min hour day month weekday',
  }),
  timezone: z.string().optional().meta({
    title: 'Timezone',
    description: 'IANA timezone for cron expressions, e.g. "Asia/Shanghai".',
  }),
  message: z.string().optional().meta({
    title: 'Message',
    description: 'Message sent to this agent when the schedule fires.',
  }),
  activeHoursStart: z.string().optional().meta({
    title: 'Active hours start',
    description: 'HH:MM — skip runs before this time.',
  }),
  activeHoursEnd: z.string().optional().meta({
    title: 'Active hours end',
    description: 'HH:MM — skip runs after this time.',
  }),
  name: z.string().optional().meta({
    title: 'Task name',
    description: 'Human-readable label for this schedule.',
  }),
}).meta({
  title: 'schedule-task',
  description: 'Create a new scheduled task that will periodically wake this agent.',
});

const ListSchedulesToolSchema = z.object({}).meta({
  title: 'list-schedules',
  description: 'List all active scheduled tasks for this agent.',
});

const RemoveScheduleToolSchema = z.object({
  taskId: z.string().meta({
    title: 'Task ID',
    description: 'ID of the scheduled task to remove (from list-schedules).',
  }),
}).meta({
  title: 'remove-schedule',
  description: 'Remove an active scheduled task by ID.',
});

const UpdateScheduleToolSchema = z.object({
  taskId: z.string().meta({
    title: 'Task ID',
    description: 'ID of the scheduled task to update (from list-schedules).',
  }),
  enabled: z.boolean().optional().meta({
    title: 'Enabled',
    description: 'Enable or disable the task without deleting it.',
  }),
  message: z.string().optional().meta({
    title: 'Message',
    description: 'New wake-up message.',
  }),
  activeHoursStart: z.string().optional().meta({ title: 'Active hours start', description: 'HH:MM' }),
  activeHoursEnd: z.string().optional().meta({ title: 'Active hours end', description: 'HH:MM' }),
}).meta({
  title: 'update-schedule',
  description: 'Update an existing scheduled task — change enabled state, message, or active hours.',
});

// ─── Tool definition ──────────────────────────────────────────────────────────

export const scheduledTaskToolDefinition = {
  toolId: 'scheduledTasks',
  displayName: 'Scheduled Tasks',
  description: 'Create and manage scheduled tasks for this agent',
  configSchema: ScheduledTaskToolParameterSchema,
  llmToolSchemas: {
    'schedule-task': ScheduleTaskToolSchema,
    'list-schedules': ListSchedulesToolSchema,
    'remove-schedule': RemoveScheduleToolSchema,
    'update-schedule': UpdateScheduleToolSchema,
  },

  onProcessPrompts({ config, injectToolList }) {
    const pos = config.toolListPosition;
    if (!pos?.targetId) return;
    injectToolList({ targetId: pos.targetId, position: pos.position || 'after' });
  },

  async onResponseComplete({ toolCall, executeToolCall, agentFrameworkContext }) {
    if (!toolCall?.found) return;
    const agentId = agentFrameworkContext.agent.id;

    // ── schedule-task ─────────────────────────────────────────────────────
    if (toolCall.toolId === 'schedule-task') {
      await executeToolCall('schedule-task', async (parameters) => {
        const { addTask } = await import('../scheduledTaskManager');
        const localNodeId = agentFrameworkContext.localNodeId;
        if (!localNodeId) throw new Error('scheduled_task_identity_unavailable');
        let schedule: ScheduleConfig;

        if (parameters.kind === 'at') {
          if (!parameters.wakeAtISO) throw new Error('wakeAtISO is required for kind="at"');
          schedule = { kind: 'at', wakeAtISO: parameters.wakeAtISO };
        } else {
          if (!parameters.cronExpression) throw new Error('cronExpression is required for kind="cron"');
          schedule = { kind: 'cron', expression: parameters.cronExpression, timezone: parameters.timezone };
        }

        const task = await addTask({
          agentInstanceId: agentId,
          agentDefinitionId: agentFrameworkContext.agent.agentDefId,
          name: parameters.name?.trim() || `Scheduled task (${parameters.kind})`,
          scheduleKind: schedule.kind,
          schedule: schedule,
          payload: parameters.message ? { message: parameters.message } : undefined,
          activeHoursStart: parameters.activeHoursStart,
          activeHoursEnd: parameters.activeHoursEnd,
          createdBy: 'agent-tool',
          enabled: true,
          executionNodeId: localNodeId,
          originNodeId: localNodeId,
        });

        return {
          success: true,
          data: `Scheduled task created (id: ${task.id}). Next run: ${task.nextRunAt ?? 'unknown'}.`,
        };
      });
      return;
    }

    // ── list-schedules ────────────────────────────────────────────────────
    if (toolCall.toolId === 'list-schedules') {
      await executeToolCall('list-schedules', async () => {
        const { getActiveTasksForAgent } = await import('../scheduledTaskManager');
        const tasks = await getActiveTasksForAgent(agentId);
        if (tasks.length === 0) {
          return { success: true, data: 'No active scheduled tasks.' };
        }
        const summary = tasks.map(t => `[${t.id}] ${t.name || t.schedule.kind} — next: ${t.nextRunAt ?? '?'} — runs: ${t.runCount ?? 0}`).join('\n');
        return { success: true, data: `Active scheduled tasks:\n${summary}` };
      });
      return;
    }

    // ── remove-schedule ───────────────────────────────────────────────────
    if (toolCall.toolId === 'remove-schedule') {
      await executeToolCall('remove-schedule', async (parameters) => {
        const { removeTask } = await import('../scheduledTaskManager');
        await removeTask(parameters.taskId);
        return { success: true, data: `Scheduled task ${parameters.taskId} removed.` };
      });
      return;
    }

    // ── update-schedule ───────────────────────────────────────────────────
    if (toolCall.toolId === 'update-schedule') {
      await executeToolCall('update-schedule', async (parameters) => {
        const { updateTask } = await import('../scheduledTaskManager');
        await updateTask({
          id: parameters.taskId,
          enabled: parameters.enabled,
          payload: parameters.message ? { message: parameters.message } : undefined,
          activeHoursStart: parameters.activeHoursStart,
          activeHoursEnd: parameters.activeHoursEnd,
        });
        return { success: true, data: `Scheduled task ${parameters.taskId} updated.` };
      });
    }
  },
} satisfies ToolDefinition<typeof ScheduledTaskToolParameterSchema, {
  'schedule-task': typeof ScheduleTaskToolSchema;
  'list-schedules': typeof ListSchedulesToolSchema;
  'remove-schedule': typeof RemoveScheduleToolSchema;
  'update-schedule': typeof UpdateScheduleToolSchema;
}>;
