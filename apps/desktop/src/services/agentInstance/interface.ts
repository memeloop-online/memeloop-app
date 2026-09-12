import { ProxyPropertyType } from 'electron-ipc-cat/common';
import type {
  AgentConversationMessagePage,
  AgentConversationMessagePageOptions,
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
  AgentFrameworkConfig,
  AgentHeartbeatConfig,
  AgentInstanceLatestStatus,
  AgentInstanceMetadata,
  AgentInstanceMetadataUpdate,
  AgentInstanceModel,
  AgentManagementCallOptions,
  AgentRuntimeView,
  AttachmentReference,
  BeginAttachmentUploadRequest,
  BeginAttachmentUploadResponse,
  ChatMessage,
  CommitAttachmentUploadRequest,
  CommitAttachmentUploadResponse,
  ConversationTimelinePage,
  DeviceCapabilities,
  DeviceRpcHandler,
  FullAgentStorage,
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
  ScheduledTaskScope,
  ScheduledTaskStoragePage,
  UpdateScheduledTaskInput,
} from './scheduledTaskTypes';

/** Canonical Core execution model and bounded metadata/message contracts. */
export type AgentInstance = AgentInstanceModel;
export type AgentInstanceMessage = ChatMessage;
export type AgentInstanceState = AgentInstanceLatestStatus['state'];

/**
 * Incremental renderer notification. Conversation history is deliberately not
 * part of this contract: the renderer obtains a bounded window through the
 * canonical conversation page contract, while a live notification carries at most one changed
 * message plus the lightweight agent metadata/run status.
 */
export interface AgentInstanceUpdate {
  agent: AgentInstanceMetadata;
  message?: ChatMessage;
}

export type {
  AgentFrameworkConfig,
  AgentHeartbeatConfig,
  AgentInstanceLatestStatus,
  AgentInstanceMetadata,
  AgentInstanceMetadataUpdate,
  AgentManagementCallOptions,
  AgentRuntimeView,
  ChatMessage,
};

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
  getMemeLoopSyncStorage(): FullAgentStorage;
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
   * @param content Message content and optional attachment.
   */
  sendMsgToAgent(agentId: string, content: {
    text: string;
    attachment?: AttachmentReference;
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
  getAgentMetadata(agentId: string): Promise<AgentInstanceMetadata | undefined>;

  /**
   * Content-free durable conversation wake stream. Consumers must re-read a
   * bounded revision-fenced page from the UtilityProcess SQLite store.
   */
  subscribeConversationMutations(): Observable<ConversationMutationWake>;

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
  getAgents(page: number, pageSize: number, options?: { closed?: boolean; searchName?: string }): Promise<AgentInstanceMetadata[]>;

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
  listScheduledTasksPageForAgent(input: ListScheduledTasksPageForAgentInput): Promise<ScheduledTaskStoragePage>;

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
