/**
 * Scheduling contracts are owned by Core.  This module only keeps the small
 * persistence-adapter cursor shapes used by the Electron database; it must not
 * grow a second ScheduledTask/CreateScheduledTaskInput model.
 */
import type {
  AgentManagementCallOptions,
  CreateScheduledTaskInput as CoreCreateScheduledTaskInput,
  ListScheduledTasksOptions as CoreListScheduledTasksOptions,
  ScheduledTask as CoreScheduledTask,
  ScheduledTaskPage as CoreScheduledTaskPage,
  ScheduledTaskState as CoreScheduledTaskState,
} from 'memeloop';

export type ScheduleKind = CoreCreateScheduledTaskInput['scheduleKind'];
export type ScheduleConfig = CoreCreateScheduledTaskInput['schedule'];
export type ScheduledTask = CoreScheduledTask;
export type CreateScheduledTaskInput = CoreCreateScheduledTaskInput;
export type ListScheduledTasksOptions = CoreListScheduledTasksOptions;
export type ScheduledTaskState = CoreScheduledTaskState;
export type ScheduledTaskCallOptions = AgentManagementCallOptions;

/**
 * Keyset position for the local SQL adapter.  The public Core page exposes an
 * opaque cursor; this physical position never crosses the service boundary.
 */
export interface ScheduledTaskPagePosition {
  updatedAt: string;
  id: string;
}

export interface ListScheduledTasksPageForAgentInput {
  agentInstanceId: string;
  executionNodeId: string;
  states: ScheduledTaskState[];
  limit: number;
  after?: ScheduledTaskPagePosition;
  expectedRevision?: string;
  signal?: AbortSignal;
}

/** SQL adapter page.  `next` is translated to Core's opaque cursor by the host. */
export interface ScheduledTaskStoragePage {
  items: ScheduledTask[];
  revision: string;
  next?: ScheduledTaskPagePosition;
}

/** Keep the Core page visible to consumers that need the portable contract. */
export type CoreScheduledTaskPageContract = CoreScheduledTaskPage;

/** Resource identity used for authenticated main-process mutations. */
export interface ScheduledTaskScope {
  taskId: string;
  agentInstanceId: string;
  agentDefinitionId: string;
  executionNodeId: string;
}

export interface RemoteScheduledTaskProjection {
  task: ScheduledTask;
  observedAt: number;
}

export interface RemoteScheduledTaskProjectionPagePosition {
  observedAt: number;
  id: string;
}

export interface ListRemoteScheduledTaskProjectionPageInput {
  agentInstanceId: string;
  states: ScheduledTaskState[];
  executionNodeIds?: string[];
  limit: number;
  after?: RemoteScheduledTaskProjectionPagePosition;
  expectedRevision?: string;
}

export interface RemoteScheduledTaskProjectionPage {
  items: RemoteScheduledTaskProjection[];
  revision: string;
  next?: RemoteScheduledTaskProjectionPagePosition;
}

/** Core's update API carries the id separately; the service keeps it for IPC. */
export type UpdateScheduledTaskInput = Omit<Partial<CoreCreateScheduledTaskInput>, 'payload' | 'activeHoursStart' | 'activeHoursEnd' | 'executionNodeLabel'> & {
  id: string;
  payload?: { message: string } | null;
  activeHoursStart?: string | null;
  activeHoursEnd?: string | null;
  executionNodeLabel?: string | null;
};
