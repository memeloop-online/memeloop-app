import { ProxyPropertyType } from 'electron-ipc-cat/common';
import type {
  AgentConversationMessagePage,
  AgentConversationMessagePageOptions,
  AgentConversationMessagePageSuccess,
  AgentConversationMessageWindowRequest,
  AgentConversationMessageWindowResult,
  AgentDeviceRpcDeleteTurnRequest,
  AgentDeviceRpcDeleteTurnResponse,
  AgentDeviceRpcGetConversationTimelinePageRequest,
  AgentDeviceRpcGetMessageDetailRequest,
  AgentDeviceRpcGetMessageDetailResponse,
  AgentDeviceRpcGetTurnDetailRequest,
  AgentDeviceRpcGetTurnDetailResponse,
  AgentDeviceRpcRetryTurnRequest,
  AgentDeviceRpcRetryTurnResponse,
  AgentDeviceRpcRunTurnRequest,
  AgentDeviceRpcTurnAcceptedResponse,
  AttachmentReference,
  BeginAttachmentUploadRequest,
  BeginAttachmentUploadResponse,
  CommitAttachmentUploadRequest,
  CommitAttachmentUploadResponse,
  ConversationTimelinePage,
  DeviceCapabilities,
  DeviceRpcHandler,
  GetMessagePageOptions,
  IAgentStorage,
  PromptPreviewAuditDetailChunk,
  PromptPreviewAuditDetailRequest,
  PromptPreviewAuditPage,
  PromptPreviewAuditPageRequest,
  PromptPreviewAuditReleaseRequest,
  PromptPreviewPreparedExecution,
  RemoteOrchestrationRequest,
  RemoteOrchestrationResponse,
  UploadAttachmentChunkRequest,
  UploadAttachmentChunkResponse,
} from 'memeloop';
import type { Observable } from 'rxjs';

import { AgentChannel } from '@/constants/channels';
import { AgentDefinition } from '@services/agentDefinition/interface';
import type { ConversationMutationWake } from './conversationMutationObserver';
export type { ConversationMutationHint, ConversationMutationWake } from './conversationMutationObserver';
import type {
  CreateScheduledTaskInput,
  ListRemoteScheduledTaskProjectionPageInput,
  ListScheduledTasksOptions,
  ListScheduledTasksPageForAgentInput,
  RemoteScheduledTaskProjectionPage,
  ScheduledTask,
  ScheduledTaskCallOptions,
  ScheduledTaskPage,
  ScheduledTaskScope,
  UpdateScheduledTaskInput,
} from './scheduledTaskTypes';

/**
 * Content of a session instance that user chat with an agent.
 * Inherits import { AgentFrameworkConfig } optional to allow fallback.
 * The instance can override the definition's configuration, or fall back to using it.
 */
export interface AgentInstance extends Omit<AgentDefinition, 'name' | 'agentFrameworkConfig'> {
  /** Agent description ID that generates this instance */
  agentDefId: string;
  /** Session name, optional in instance unlike definition */
  name?: string;
  /** Agent framework's config - optional, falls back to AgentDefinition.agentFrameworkConfig if not set */
  agentFrameworkConfig?: Record<string, unknown>;
  /**
   * Message history.
   * latest on top, so it's easy to get first one as user's latest input, and rest as history.
   */
  messages: AgentInstanceMessage[];
  status: AgentInstanceLatestStatus;
  /** Session creation time (converted from ISO string) */
  created: Date;
  /**
   * Last update time (converted from ISO string).
   * We don't need `created` for message because it might be stream generated, we only care about its complete time.
   */
  modified?: Date;
  /**
   * Indicates whether this agent instance is closed. Closed instances are not deleted from database
   * but are hidden from the default list and don't consume resources.
   */
  closed?: boolean;
  /**
   * Indicates whether this agent instance is a preview instance used for testing during agent creation.
   * Preview instances are excluded from normal agent instance lists and should be cleaned up automatically.
   */
  volatile?: boolean;
  /**
   * Indicates this instance was spawned by another agent (sub-agent).
   * Sub-agent instances are hidden from the default user-facing list.
   */
  isSubAgent?: boolean;
  /** Parent agent instance ID if this is a sub-agent */
  parentAgentId?: string;
}

/**
 * Represents the state of a task within the A2A protocol.
 * @description An enumeration.
 */
export type AgentInstanceState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'unknown';

/**
 * Represents the status of a task at a specific point in time.
 */
export interface AgentInstanceLatestStatus {
  /**
   * The current state of the task.
   */
  state: AgentInstanceState;

  /**
   * An optional message associated with the current status (e.g., progress update, final response).
   * @default undefined
   */
  message?: AgentInstanceMessage;

  /** Creation time (converted from ISO string) */
  created?: Date;
  /** Last update time (converted from ISO string) */
  modified?: Date;
}

export interface AgentInstanceMessage {
  /** Message nano ID */
  id: string;
  agentId: string;
  /** Stable user-rooted turn identity. A user root has `id === turnId`. */
  turnId?: string;
  /** Canonical sync identity retained by the disposable UI projection. */
  originNodeId?: string;
  lamportClock?: number;
  originSequence?: number;
  /** Message role */
  role: 'user' | 'assistant' | 'agent' | 'tool' | 'error';
  /** Message content */
  content: string;
  /**
   * Reasoning or thinking content, separated from main content
   * Primarily used with DeepSeek which returns reasoning content separately
   */
  reasoning_content?: string;
  contentType?: string; // 'text/plain' | 'text/markdown' | 'text/html' | 'application/json' | 'application/json+ndjson';
  /** Creation time (converted from ISO string) */
  created?: Date;
  /** Last update time (converted from ISO string) */
  modified?: Date;
  /** Message metadata */
  metadata?: Record<string, unknown>;
  /** Whether this message should be hidden from UI/history (default: false) */
  hidden?: boolean;
  /**
   * Duration in rounds that this message should be included in AI context
   * When set to a number > 0, the message will only be sent to AI for that many rounds from current position
   * undefined/null means the message persists in AI context indefinitely (default behavior)
   * 0 means the message is excluded from AI context immediately but remains visible in UI
   */
  duration?: number | null;
}

/**
 * Incremental renderer notification. Conversation history is deliberately not
 * part of this contract: the renderer obtains a bounded window through
 * `getAgentMessagePage`, while a live notification carries at most one changed
 * message plus the lightweight agent metadata/run status.
 */
export interface AgentInstanceUpdate {
  agent: Omit<AgentInstance, 'messages'>;
  message?: AgentInstanceMessage;
}

/** Compatibility-only bounded reader used by one background tool. */
export type LegacyAgentMessagePageOptions = Omit<GetMessagePageOptions, 'maxBytes'> & {
  maxBytes?: number;
};

export interface AgentBackgroundTask {
  agentId: string;
  agentName?: string;
  type: 'heartbeat' | 'alarm';
  intervalSeconds?: number;
  activeHoursStart?: string;
  activeHoursEnd?: string;
  wakeAtISO?: string;
  nextWakeAtISO?: string;
  message?: string;
  repeatIntervalMinutes?: number;
  createdBy?: string;
  lastRunAtISO?: string;
  runCount?: number;
}

export interface PreparePromptPreviewExecutionRequest {
  conversationId: string;
  requestId: string;
  inputText?: string;
}

export interface ExportAgentMessageRequest {
  conversationId: string;
  messageId: string;
  /** Renderer-minted cancellation identity; no message bytes cross IPC. */
  requestId: string;
}

export interface ExportAgentMessageResult {
  saved: boolean;
  bytesWritten?: number;
}

export interface SetBackgroundAlarmInput {
  wakeAtISO: string;
  message?: string;
  repeatIntervalMinutes?: number;
}

export interface SetBackgroundHeartbeatInput {
  enabled: boolean;
  intervalSeconds: number;
  message?: string;
  activeHoursStart?: string;
  activeHoursEnd?: string;
}

/**
 * Agent instance service to manage chat instances and messages
 */
export interface IAgentInstanceService {
  /**
   * Initialize the service on application startup
   */
  initialize(): Promise<void>;
  /**
   * For testing purposes, only initialize the built-in handlers without database
   */
  initializeFrameworks(): Promise<void>;

  /** Main-process-only adapters backed by the UtilityProcess CLI SQLite store. */
  getMemeLoopSyncStorage(): IAgentStorage;
  getMemeLoopDeviceRpcHandler(): DeviceRpcHandler;
  getMemeLoopDeviceCapabilities(): Promise<DeviceCapabilities>;

  /** Policy-scoped declarative resource request; renderer never receives the bearer token. */
  requestOrchestration(
    request: RemoteOrchestrationRequest,
  ): Promise<RemoteOrchestrationResponse>;

  /** Stream declarative resource watch responses over the existing IPC bridge. */
  subscribeToOrchestrationWatch(
    request: RemoteOrchestrationRequest,
  ): Observable<RemoteOrchestrationResponse>;

  /**
   * Create a new agent instance from a definition
   * @param agentDefinitionID Agent definition ID, if not provided, will use the default agent
   * @param options Additional options for creating the agent instance
   */
  createAgent(agentDefinitionID?: string, options?: { preview?: boolean; volatile?: boolean }): Promise<AgentInstance>;

  /**
   * Send a message or file to an agent instance, and put response to observables. Persistence and tool calling is handled by the plugins.
   * @param agentId Agent ID
   * @param content Message content including text, optional file, and optional wiki tiddlers
   */
  sendMsgToAgent(agentId: string, content: {
    text: string;
    attachment?: AttachmentReference;
    /**
     * Wiki tiddlers to attach. Each entry contains workspace name and tiddler title.
     * The rendered HTML content of these tiddlers will be fetched and included in the prompt.
     */
    wikiTiddlers?: Array<{ workspaceName: string; tiddlerTitle: string }>;
  }): Promise<void>;

  /** Execute one provenance-bound local turn and resolve at terminal success. */
  executeAgentTurn(request: AgentDeviceRpcRunTurnRequest): Promise<AgentDeviceRpcTurnAcceptedResponse>;

  /**
   * Main-process scheduling port. Resolves only after the durable Core run is
   * terminal-successful; the occurrence/attempt pair is its replay fence.
   * This method is deliberately not exposed through renderer IPC.
   */
  runScheduledTaskAgent(agentId: string, message: string, options: {
    occurrenceId: string;
    scheduledFor: string;
    attempt: number;
    signal: AbortSignal;
  }): Promise<void>;

  /** Conversation-scoped durable upload; Core RPC validation runs in the UtilityProcess. */
  beginAgentAttachmentUpload(request: BeginAttachmentUploadRequest): Promise<BeginAttachmentUploadResponse>;
  uploadAgentAttachmentChunk(request: UploadAttachmentChunkRequest): Promise<UploadAttachmentChunkResponse>;
  commitAgentAttachmentUpload(request: CommitAttachmentUploadRequest): Promise<CommitAttachmentUploadResponse>;

  /** Retain the exact worker-side model request and return only its bounded audit handle. */
  preparePromptPreviewExecution(request: PreparePromptPreviewExecutionRequest): Promise<PromptPreviewPreparedExecution>;
  getPromptPreviewAuditPage(request: PromptPreviewAuditPageRequest): Promise<PromptPreviewAuditPage>;
  getPromptPreviewAuditDetail(request: PromptPreviewAuditDetailRequest): Promise<PromptPreviewAuditDetailChunk>;
  releasePromptPreviewAuditSession(request: PromptPreviewAuditReleaseRequest): Promise<void>;
  cancelPromptPreview(requestId: string): Promise<void>;

  /**
   * Subscribe to agent instance updates
   * @param agentId Agent instance ID
   */
  subscribeToAgentUpdates(agentId: string): Observable<AgentInstanceUpdate | undefined>;
  /** Metadata-only read for renderer views; never joins the message table. */
  getAgentMetadata(agentId: string): Promise<AgentInstance | undefined>;

  /**
   * Content-free durable conversation wake stream. Consumers must re-read a
   * bounded revision-fenced page from the UtilityProcess SQLite store.
   */
  subscribeConversationMutations(): Observable<ConversationMutationWake>;

  /** Compatibility-only bounded storage page; main chat uses the opaque v2 transport below. */
  getAgentMessagePage(agentId: string, options: LegacyAgentMessagePageOptions): Promise<AgentConversationMessagePageSuccess>;

  /** Opaque-cursor, revision-fenced v2 page projected by the UtilityProcess RPC handler. */
  getAgentConversationMessagePage(
    conversationId: string,
    options: AgentConversationMessagePageOptions,
  ): Promise<AgentConversationMessagePage>;

  /** One atomic, revision-consistent indexed seek around a turn/timeline entry. */
  getAgentConversationMessageWindow(
    request: AgentConversationMessageWindowRequest,
  ): Promise<AgentConversationMessageWindowResult>;

  /** Indexed, revisioned timeline page; never samples or scans history in Electron. */
  getAgentConversationTimelinePage(
    request: AgentDeviceRpcGetConversationTimelinePageRequest,
  ): Promise<ConversationTimelinePage>;

  /** Bounded on-demand turn detail. */
  getAgentConversationTurnDetail(
    request: AgentDeviceRpcGetTurnDetailRequest,
  ): Promise<AgentDeviceRpcGetTurnDetailResponse>;

  /** One bounded persisted canonical-JSON detail range (256 KiB maximum). */
  getAgentConversationMessageDetail(
    request: AgentDeviceRpcGetMessageDetailRequest,
  ): Promise<AgentDeviceRpcGetMessageDetailResponse>;

  /** Save one canonical message through a main-process-only bounded file sink. */
  exportAgentMessage(request: ExportAgentMessageRequest): Promise<ExportAgentMessageResult>;
  cancelAgentMessageExport(requestId: string): Promise<void>;

  /** Append a canonical turn tombstone through the v2 runtime RPC. */
  deleteAgentTurn(request: AgentDeviceRpcDeleteTurnRequest): Promise<AgentDeviceRpcDeleteTurnResponse>;

  /** Atomically tombstone and retry through the v2 runtime RPC. */
  retryAgentTurn(request: AgentDeviceRpcRetryTurnRequest): Promise<AgentDeviceRpcRetryTurnResponse>;

  /** Retry through the same atomic RPC and resolve at terminal success. */
  retryAgentTurnAndWait(request: AgentDeviceRpcRetryTurnRequest): Promise<AgentDeviceRpcRetryTurnResponse>;

  /**
   * Update agent instance data
   * @param agentId Agent instance ID
   * @param data Updated data
   */
  updateAgent(agentId: string, data: Partial<AgentInstance>): Promise<AgentInstance>;

  /**
   * Delete agent instance and all its messages
   * @param agentId Agent instance ID
   */
  deleteAgent(agentId: string): Promise<void>;

  /**
   * Cancel current operations for agent instance
   * @param agentId Agent instance ID
   */
  cancelAgent(agentId: string): Promise<void>;

  /**
   * Get all agent instances with pagination and optional filters
   * Only return light-weight instance data without messages to avoid unnecessary payload.
   * @param page Page number
   * @param pageSize Number of items per page
   * @param options Filter options
   */
  getAgents(page: number, pageSize: number, options?: { closed?: boolean; searchName?: string }): Promise<Omit<AgentInstance, 'messages'>[]>;

  /**
   * Close agent instance without deleting it
   * @param agentId Agent instance ID
   */
  closeAgent(agentId: string): Promise<void>;

  /**
   * Get JSON Schema for handler configuration
   * This allows frontend to generate a form based on the schema for a specific handler
   * @param agentFrameworkID Handler ID to get schema for
   * @returns JSON Schema for handler configuration
   */
  getFrameworkConfigSchema(frameworkId: string): Record<string, unknown>;

  /** @deprecated Legacy prompt plugin port. Production runtime does not call it. */
  saveUserMessage(userMessage: AgentInstanceMessage): Promise<void>;
  /** @deprecated Legacy prompt plugin port. Production runtime does not call it. */
  debounceUpdateMessage(message: AgentInstanceMessage, agentId?: string, debounceMs?: number): void;

  /**
   * Resolve a pending tool approval request from the UI
   * @param approvalId The approval request ID
   * @param decision 'allow' or 'deny'
   */
  resolveToolApproval(approvalId: string, decision: 'allow' | 'deny'): Promise<void>;

  /**
   * Resolve a pending ask-question request from the UI.
   * The user's answer is sent as a tool result (same turn), not as a new user message.
   * @param agentId The agent instance ID
   * @param questionId The question ID embedded in the ask-question tool result
   * @param answer The user's answer text
   */
  resolveAskQuestion(agentId: string, questionId: string, answer: string): void;

  /**
   * Get all active background tasks (heartbeats + alarms) for display in settings UI.
   */
  getBackgroundTasks(): Promise<AgentBackgroundTask[]>;

  /**
   * Cancel a background task by agent ID and type.
   */
  cancelBackgroundTask(agentId: string, type: 'heartbeat' | 'alarm'): Promise<void>;

  /**
   * Create or update an alarm task from settings UI.
   */
  setBackgroundAlarm(agentId: string, alarm: SetBackgroundAlarmInput): Promise<void>;

  /**
   * Create or update heartbeat configuration from settings UI.
   */
  setBackgroundHeartbeat(agentId: string, heartbeat: SetBackgroundHeartbeatInput): Promise<void>;

  // ── ScheduledTask CRUD (Phase 2) ──────────────────────────────────────────

  /**
   * Create a new scheduled task and start its timer.
   */
  createScheduledTask(input: CreateScheduledTaskInput, options?: ScheduledTaskCallOptions): Promise<ScheduledTask>;

  /**
   * Update an existing scheduled task (restarts timer with new config).
   */
  updateScheduledTask(input: UpdateScheduledTaskInput): Promise<ScheduledTask>;

  /** Main-process-only atomic full-scope mutation used by authenticated RPC. */
  updateScheduledTaskScoped(scope: ScheduledTaskScope, input: UpdateScheduledTaskInput, options?: ScheduledTaskCallOptions): Promise<ScheduledTask>;

  /**
   * Delete a scheduled task and stop its timer.
   */
  deleteScheduledTask(taskId: string): Promise<void>;

  /** Main-process-only atomic full-scope soft delete used by authenticated RPC. */
  deleteScheduledTaskScoped(scope: ScheduledTaskScope, options?: ScheduledTaskCallOptions): Promise<void>;

  /** Main-process-only full-scope lookup used by authenticated RPC. */
  getScheduledTaskByScope(scope: ScheduledTaskScope, options?: ScheduledTaskCallOptions): Promise<ScheduledTask | undefined>;

  /**
   * List all active scheduled tasks (from in-memory registry).
   */
  listScheduledTasks(options?: ListScheduledTasksOptions): Promise<ScheduledTask[]>;

  /**
   * List active scheduled tasks for a specific agent instance.
   * Used by TabItem to show the clock indicator.
   */
  listScheduledTasksForAgent(agentInstanceId: string, options?: ListScheduledTasksOptions): Promise<ScheduledTask[]>;

  /** Main-process-only bounded keyset page used by the authenticated RPC handler. */
  listScheduledTasksPageForAgent(input: ListScheduledTasksPageForAgentInput): Promise<ScheduledTaskPage>;

  /** Bounded durable snapshots of schedules owned by remote devices. */
  listRemoteScheduledTaskProjectionPageForAgent(input: ListRemoteScheduledTaskProjectionPageInput): Promise<RemoteScheduledTaskProjectionPage>;

  replaceRemoteScheduledTaskProjections(agentInstanceId: string, executionNodeId: string, tasks: ScheduledTask[], observedAt: number): Promise<void>;
  upsertRemoteScheduledTaskProjection(task: ScheduledTask, observedAt: number): Promise<void>;
  deleteRemoteScheduledTaskProjection(taskId: string, executionNodeId: string): Promise<void>;

  /**
   * Return next N run times for a cron expression (for UI preview).
   */
  getCronPreviewDates(expression: string, timezone?: string, count?: number): Promise<string[]>;
}

export const AgentInstanceServiceIPCDescriptor = {
  channel: AgentChannel.instance,
  properties: {
    cancelAgent: ProxyPropertyType.Function,
    closeAgent: ProxyPropertyType.Function,
    createAgent: ProxyPropertyType.Function,
    deleteAgent: ProxyPropertyType.Function,
    getAgentMetadata: ProxyPropertyType.Function,
    getAgentMessagePage: ProxyPropertyType.Function,
    getAgentConversationMessagePage: ProxyPropertyType.Function,
    getAgentConversationMessageWindow: ProxyPropertyType.Function,
    getAgentConversationTimelinePage: ProxyPropertyType.Function,
    getAgentConversationTurnDetail: ProxyPropertyType.Function,
    getAgentConversationMessageDetail: ProxyPropertyType.Function,
    exportAgentMessage: ProxyPropertyType.Function,
    cancelAgentMessageExport: ProxyPropertyType.Function,
    deleteAgentTurn: ProxyPropertyType.Function,
    retryAgentTurn: ProxyPropertyType.Function,
    retryAgentTurnAndWait: ProxyPropertyType.Function,
    getAgents: ProxyPropertyType.Function,
    getFrameworkConfigSchema: ProxyPropertyType.Function,
    resolveToolApproval: ProxyPropertyType.Function,
    resolveAskQuestion: ProxyPropertyType.Function,
    requestOrchestration: ProxyPropertyType.Function,
    sendMsgToAgent: ProxyPropertyType.Function,
    executeAgentTurn: ProxyPropertyType.Function,
    beginAgentAttachmentUpload: ProxyPropertyType.Function,
    uploadAgentAttachmentChunk: ProxyPropertyType.Function,
    commitAgentAttachmentUpload: ProxyPropertyType.Function,
    preparePromptPreviewExecution: ProxyPropertyType.Function,
    getPromptPreviewAuditPage: ProxyPropertyType.Function,
    getPromptPreviewAuditDetail: ProxyPropertyType.Function,
    releasePromptPreviewAuditSession: ProxyPropertyType.Function,
    cancelPromptPreview: ProxyPropertyType.Function,
    subscribeToAgentUpdates: ProxyPropertyType.Function$,
    subscribeConversationMutations: ProxyPropertyType.Function$,
    subscribeToOrchestrationWatch: ProxyPropertyType.Function$,
    getBackgroundTasks: ProxyPropertyType.Function,
    cancelBackgroundTask: ProxyPropertyType.Function,
    setBackgroundAlarm: ProxyPropertyType.Function,
    setBackgroundHeartbeat: ProxyPropertyType.Function,
    createScheduledTask: ProxyPropertyType.Function,
    updateScheduledTask: ProxyPropertyType.Function,
    deleteScheduledTask: ProxyPropertyType.Function,
    listScheduledTasks: ProxyPropertyType.Function,
    listScheduledTasksForAgent: ProxyPropertyType.Function,
    listScheduledTasksPageForAgent: ProxyPropertyType.Function,
    listRemoteScheduledTaskProjectionPageForAgent: ProxyPropertyType.Function,
    replaceRemoteScheduledTaskProjections: ProxyPropertyType.Function,
    upsertRemoteScheduledTaskProjection: ProxyPropertyType.Function,
    deleteRemoteScheduledTaskProjection: ProxyPropertyType.Function,
    getCronPreviewDates: ProxyPropertyType.Function,
    updateAgent: ProxyPropertyType.Function,
  },
};
