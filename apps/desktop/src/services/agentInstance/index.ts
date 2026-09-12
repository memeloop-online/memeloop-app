import { createWorkerProxy, safePostMessage } from '@services/libs/workerAdapter';
import type { ModelMessage } from 'ai';
import { app, dialog } from 'electron';
import type { UtilityProcess } from 'electron';
import { inject, injectable } from 'inversify';
import {
  AGENT_DEVICE_RPC_METHODS,
  type AgentConversationMessagePage,
  type AgentConversationMessagePageOptions,
  type AgentConversationMessageWindowRequest,
  type AgentConversationMessageWindowResult,
  type AgentDeviceRpcDeleteTurnRequest,
  type AgentDeviceRpcDeleteTurnResponse,
  type AgentDeviceRpcGetConversationTimelinePageRequest,
  type AgentDeviceRpcGetMessageDetailRequest,
  type AgentDeviceRpcGetMessageDetailResponse,
  type AgentDeviceRpcGetTurnDetailRequest,
  type AgentDeviceRpcGetTurnDetailResponse,
  type AgentDeviceRpcRetryTurnRequest,
  type AgentDeviceRpcRetryTurnResponse,
  type AgentDeviceRpcRunTurnRequest,
  type AgentDeviceRpcTurnAcceptedResponse,
  assertAgentDeviceRpcRequest,
  type AttachmentReference,
  type BeginAttachmentUploadRequest,
  type BeginAttachmentUploadResponse,
  type ChatMessage,
  type CommitAttachmentUploadRequest,
  type CommitAttachmentUploadResponse,
  type ConversationMessageDetailRange,
  type ConversationMeta,
  type ConversationTimelinePage,
  createChatMessage,
  createFetchOrchestrationTransport,
  type DeviceCapabilities,
  type DeviceRpcHandler,
  type FullAgentStorage,
  type LocalDeviceIdentity,
  type PromptPreviewAuditDetailChunk,
  type PromptPreviewAuditDetailRequest,
  type PromptPreviewAuditPage,
  type PromptPreviewAuditPageRequest,
  type PromptPreviewAuditReleaseRequest,
  type PromptPreviewPreparedExecution,
  type RemoteOrchestrationRequest,
  type RemoteOrchestrationResponse,
  type RemoteOrchestrationTransport,
  type UploadAttachmentChunkRequest,
  type UploadAttachmentChunkResponse,
} from 'memeloop';
import { nanoid } from 'nanoid';
import { randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { DataSource, Repository } from 'typeorm';
import type { ExportAgentMessageRequest, ExportAgentMessageResult, PreparePromptPreviewExecutionRequest } from './interface';
import type { MemeLoopWorker } from './memeloopWorker';
import createMemeLoopUtilityProcess from './memeloopWorkerFactory';
import { AGENT_MESSAGE_EXPORT_CHUNK_BYTES, AGENT_MESSAGE_EXPORT_MAX_BYTES, streamAgentMessageDetailRanges } from './messageExport';

import { USER_DATA_FOLDER } from '@/constants/appPaths';
import { SQLITE_BINARY_PATH } from '@/constants/paths';
import type { AgentHeartbeatConfig } from '@services/agentDefinition/interface';
import type { IAgentDefinitionService } from '@services/agentDefinition/interface';
import { getPromptConcatAgentFrameworkConfigJsonSchema } from '@services/agentInstance/promptConcat/promptConcatSchema/jsonSchema';
import { container } from '@services/container';
import type { IDatabaseService } from '@services/database/interface';
import { AgentInstanceEntity, AgentInstanceMessageEntity, RemoteScheduledTaskProjectionEntity, ScheduledTaskEntity } from '@services/database/schema/agent';
import { logger } from '@services/libs/log';
import type { IProviderRegistryService } from '@services/providerRegistry/interface';
import serviceIdentifier from '@services/serviceIdentifier';

import * as repo from './agentRepository';
import type { ConversationMutationWake } from './conversationMutationObserver';
import { startHeartbeat, stopHeartbeat } from './heartbeatManager';
import type {
  AgentInstance,
  AgentInstanceLatestStatus,
  AgentInstanceMessage,
  AgentInstanceMetadata,
  AgentInstanceUpdate,
  IAgentInstanceService,
  SetBackgroundHeartbeatInput,
} from './interface';
import {
  deleteRemoteScheduledTaskProjection as deleteRemoteProjection,
  getRemoteScheduledTaskProjectionPage,
  replaceRemoteScheduledTaskProjections as replaceRemoteProjections,
  upsertRemoteScheduledTaskProjection as upsertRemoteProjection,
} from './remoteScheduledTaskProjectionStore';
import {
  addTask as stmAddTask,
  cancelTasksForAgent,
  deleteTasksForAgent,
  getActiveTasks as stmGetActiveTasks,
  getActiveTasksForAgent as stmGetActiveTasksForAgent,
  getCronPreviewDates as stmGetCronPreviewDates,
  getScheduledTasksPageForAgent as stmGetScheduledTasksPageForAgent,
  getTaskByScope as stmGetTaskByScope,
  initScheduledTaskManager,
  removeTask as stmRemoveTask,
  removeTaskScoped as stmRemoveTaskScoped,
  restoreScheduledTasks,
  updateTask as stmUpdateTask,
  updateTaskScoped as stmUpdateTaskScoped,
} from './scheduledTaskManager';
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
import { cleanupMCPClient } from './tools/modelContextProtocol';
import { type AppAgentToolRuntime, bootstrapAppAgentToolRuntime } from './tools/runtime';

const MEMELOOP_UTILITY_PROCESS_INITIALIZATION_TIMEOUT_MS = 30_000;
const MAX_UTILITY_PROCESS_LOG_BYTES = 4 * 1024;
const MAX_UTILITY_PROCESS_LOG_EVENTS_PER_SECOND = 100;

type UtilityProcessLogLimiter = {
  allow: () => boolean;
  text: (data: unknown) => string;
};

function createUtilityProcessLogLimiter(): UtilityProcessLogLimiter {
  let windowStartedAt = Date.now();
  let windowCount = 0;
  return {
    allow: () => {
      const now = Date.now();
      if (now - windowStartedAt >= 1000) {
        windowStartedAt = now;
        windowCount = 0;
      }
      if (windowCount >= MAX_UTILITY_PROCESS_LOG_EVENTS_PER_SECOND) return false;
      windowCount += 1;
      return true;
    },
    text: data => {
      const value = Buffer.isBuffer(data)
        ? data
        : Buffer.from(typeof data === 'string' ? data : String(data), 'utf8');
      if (value.byteLength <= MAX_UTILITY_PROCESS_LOG_BYTES) return value.toString('utf8');
      return `${value.subarray(0, MAX_UTILITY_PROCESS_LOG_BYTES).toString('utf8')}…`;
    },
  };
}

type UtilityProcessReadyApp = typeof app & {
  isReady?: () => boolean;
  whenReady?: () => Promise<unknown>;
};

async function waitForElectronReady(): Promise<void> {
  const readyApp = app as UtilityProcessReadyApp;
  if (readyApp.isReady?.()) return;
  await readyApp.whenReady?.();
}

function waitForUtilityProcessSpawn(
  child: UtilityProcess,
  signal: AbortSignal,
): Promise<void> {
  if (child.pid !== undefined) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      finish(new Error('MemeLoop UtilityProcess spawn timed out'));
    }, MEMELOOP_UTILITY_PROCESS_INITIALIZATION_TIMEOUT_MS);
    const onSpawn = (): void => {
      finish(undefined);
    };
    const onExit = (code: number): void => {
      finish(new Error(`MemeLoop UtilityProcess exited before spawn with code ${code}`));
    };
    const onAbort = (): void => {
      finish(
        signal.reason instanceof Error
          ? signal.reason
          : new Error('MemeLoop UtilityProcess startup aborted'),
      );
    };
    const finish = (error: Error | undefined): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      child.removeListener('spawn', onSpawn);
      child.removeListener('exit', onExit);
      if (error) reject(error);
      else resolve();
    };
    child.once('spawn', onSpawn);
    child.once('exit', onExit);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function getWorkerErrorDetails(error: unknown): {
  message: string;
  name: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return { message: error.message, name: error.name, stack: error.stack };
  }
  return { message: String(error), name: 'Error' };
}

@injectable()
export class AgentInstanceService implements IAgentInstanceService {
  @inject(serviceIdentifier.Database)
  private readonly databaseService!: IDatabaseService;

  @inject(serviceIdentifier.AgentDefinition)
  private readonly agentDefinitionService!: IAgentDefinitionService;

  private dataSource: DataSource | null = null;
  private agentInstanceRepository: Repository<AgentInstanceEntity> | null = null;
  private agentMessageRepository: Repository<AgentInstanceMessageEntity> | null = null;
  private remoteScheduledTaskProjectionRepository: Repository<RemoteScheduledTaskProjectionEntity> | null = null;
  private scheduledTaskRepositoryReady = false;

  private agentInstanceSubjects: Map<
    string,
    BehaviorSubject<AgentInstanceUpdate | undefined>
  > = new Map();
  private frameworkSchemas: Map<string, Record<string, unknown>> = new Map();
  private agentToolRuntime?: AppAgentToolRuntime;
  private memeLoopUtilityProcess?: UtilityProcess;
  private memeLoopStartupAbortController?: AbortController;
  private memeLoopDisposePromise?: Promise<void>;
  private memeLoopWorker?: MemeLoopWorker;
  private memeLoopWorkerLogCleanup?: () => void;
  private readonly workerConversationMutationSubscriptions = new Set<Subscription>();
  private workerAgentIdByConversationId: Map<string, string> = new Map();
  private workerActiveTurnIdByConversationId: Map<string, string> = new Map();
  private workerActiveRunIdByConversationId: Map<string, string> = new Map();
  private readonly workerScheduledTaskCallAbortControllers = new Map<string, AbortController>();
  private readonly workerHostCallbackAbortControllers = new Map<string, AbortController>();
  private readonly messageExportAbortControllers = new Map<string, AbortController>();
  private readonly memeLoopOrchestrationToken = randomBytes(32).toString('base64url');
  private memeLoopOrchestrationEndpoint?: string;
  private memeLoopHostIdentity?: LocalDeviceIdentity;
  private memeLoopSyncStorage?: FullAgentStorage;

  public configureMemeLoopHostIdentity(identity: LocalDeviceIdentity): void {
    if (this.memeLoopWorker || this.memeLoopUtilityProcess) {
      throw new Error('MemeLoop host identity must be configured before the UtilityProcess starts');
    }
    this.memeLoopHostIdentity = { ...identity };
  }

  private requireMemeLoopHostPeerId(): string {
    const peerId = this.memeLoopHostIdentity?.peerId;
    if (!peerId) {
      throw new Error('memeloop_host_identity_not_configured');
    }
    return peerId;
  }

  private abortUtilityProcessHostCallbacks(reason: Error): void {
    for (const controller of this.workerScheduledTaskCallAbortControllers.values()) {
      controller.abort(reason);
    }
    this.workerScheduledTaskCallAbortControllers.clear();
    for (const controller of this.workerHostCallbackAbortControllers.values()) {
      controller.abort(reason);
    }
    this.workerHostCallbackAbortControllers.clear();
  }

  /** Remove subscriptions bound to a dead process but keep durable IDs so a
   * replacement UtilityProcess can subscribe to the same Core conversations. */
  private detachCrashedWorkerConversations(): void {
    for (const cleanup of this.workerConversationCleanupByAgentId.values()) {
      try {
        cleanup();
      } catch {
        // A dead process may reject unsubscribe; keep clearing local maps so
        // the replacement process can bind fresh subscriptions.
        logger.warn('MemeLoop UtilityProcess conversation cleanup failed after exit');
      }
    }
    this.workerConversationCleanupByAgentId.clear();
    this.workerAgentIdByConversationId.clear();
    this.workerActiveTurnIdByConversationId.clear();
    this.workerActiveRunIdByConversationId.clear();
  }

  /**
   * Internal accessor for the runtime proxy — used by MemeloopNode service
   * to delegate peer/sync operations to the isolated UtilityProcess.
   */
  async getMemeLoopWorkerProxy(): Promise<MemeLoopWorker> {
    await this.ensureMemeLoopWorkerHealthy();
    if (!this.memeLoopWorker) throw new Error('MemeLoop UtilityProcess runtime not available');
    return this.memeLoopWorker;
  }

  /**
   * Return a structured-clone adapter to the CLI SQLite store owned by the
   * UtilityProcess. No SQLite connection or competing MemeLoop store is opened
   * in the Electron main process.
   */
  public getMemeLoopSyncStorage(): FullAgentStorage {
    if (this.memeLoopSyncStorage) return this.memeLoopSyncStorage;
    const call = <T>(method: string, ...arguments_: unknown[]): Promise<T> => this.callMemeLoopWorkerStorage(method, ...arguments_);
    const storage: FullAgentStorage = {
      listConversationsPage: options => call('listConversationsPage', options),
      getMessagePage: (conversationId, options) => call('getMessagePage', conversationId, options),
      getFullContentMessagePage: (conversationId, options) => call('getFullContentMessagePage', conversationId, options),
      getMessageWindowAround: (conversationId, options) => call('getMessageWindowAround', conversationId, options),
      getConversationTimelinePage: (conversationId, options) => call('getConversationTimelinePage', conversationId, options),
      getMessageIdentity: (conversationId, messageId, options) => call('getMessageIdentity', conversationId, messageId, options),
      readMessageDetailRange: (conversationId, messageId, offset, maxBytes, options) => call('readMessageDetailRange', conversationId, messageId, offset, maxBytes, options),
      getConversationEventPage: (conversationId, options) => call('getConversationEventPage', conversationId, options),
      appendLocalEvent: draft => call('appendLocalEvent', draft),
      appendLocalEventsAtomic: drafts => call('appendLocalEventsAtomic', drafts),
      insertEventsIfAbsent: events => call('insertEventsIfAbsent', events),
      getEventVersionFrontierPage: options => call('getEventVersionFrontierPage', options),
      getEventVersionFrontiersForKeys: (keys, options) => call('getEventVersionFrontiersForKeys', keys, options),
      getCompactionCandidatePage: (conversationId, options, callOptions) => call('getCompactionCandidatePage', conversationId, options, callOptions),
      getRetainedCompactionControls: (conversationId, options, callOptions) => call('getRetainedCompactionControls', conversationId, options, callOptions),
      getMaxLamportClockForConversation: conversationId => call('getMaxLamportClockForConversation', conversationId),
      upsertConversationMetadata: async meta => {
        await call('upsertConversationMetadata', meta);
        await this.projectSyncedConversation(meta);
      },
      getConversationMeta: (conversationId, options) => call('getConversationMeta', conversationId, options),
      getAttachment: (contentHash, options) => call('getAttachment', contentHash, options),
      saveAttachment: (reference, data) => call('saveAttachment', reference, data),
      readAttachmentData: contentHash => call('readAttachmentData', contentHash),
      readAttachmentRange: (contentHash, offset, maxBytes, options) => call('readAttachmentRange', contentHash, offset, maxBytes, options),
      stageAttachmentChunk: (reference, offset, data, options) => call('stageAttachmentChunk', reference, offset, data, options),
      commitStagedAttachment: (contentHash, options) => call('commitStagedAttachment', contentHash, options),
      verifyAttachment: (contentHash, options) => call('verifyAttachment', contentHash, options),
      conversationReferencesAttachment: (conversationId, contentHash, options) => call('conversationReferencesAttachment', conversationId, contentHash, options),
      getAgentDefinition: id => call('getAgentDefinition', id),
      saveAgentInstance: meta => call('saveAgentInstance', meta),
      getImBinding: (channelId, imUserId) => call('getImBinding', channelId, imUserId),
      setImBinding: record => call('setImBinding', record),
    };
    this.memeLoopSyncStorage = storage;
    return storage;
  }

  private async callMemeLoopWorkerStorage<T>(method: string, ...arguments_: unknown[]): Promise<T> {
    const worker = await this.getMemeLoopWorkerProxy();
    return await worker.storageCall(method, arguments_) as T;
  }

  /**
   * Wake subscribers after the UtilityProcess SQLite transaction advances a
   * conversation projection. The wake intentionally carries no message
   * content; renderer clients re-read their bounded revision-fenced window.
   */
  public subscribeConversationMutations(): Observable<ConversationMutationWake> {
    return new Observable<ConversationMutationWake>(subscriber => {
      let disposed = false;
      let subscription: Subscription | undefined;
      void this.ensureMemeLoopWorkerHealthy().then(() => {
        if (disposed || !this.memeLoopWorker) return;
        subscription = this.memeLoopWorker.subscribeConversationMutations().subscribe({
          next: wake => {
            subscriber.next(wake);
          },
          error: (error: unknown) => {
            subscriber.error(error);
          },
          complete: () => {
            subscriber.complete();
          },
        });
        this.workerConversationMutationSubscriptions.add(subscription);
      }).catch((error: unknown) => {
        if (!disposed) subscriber.error(error);
      });
      return () => {
        disposed = true;
        subscription?.unsubscribe();
        if (subscription) this.workerConversationMutationSubscriptions.delete(subscription);
      };
    });
  }

  public getMemeLoopDeviceRpcHandler(): DeviceRpcHandler {
    return async input => {
      const worker = await this.getMemeLoopWorkerProxy();
      return worker.handleDeviceRpc(input);
    };
  }

  public async getMemeLoopDeviceCapabilities(): Promise<DeviceCapabilities> {
    const worker = await this.getMemeLoopWorkerProxy();
    return worker.getDeviceCapabilities();
  }

  /** Maintain only a disposable legacy UI projection; runtime and sync never read it. */
  private async projectSyncedConversation(meta: ConversationMeta): Promise<void> {
    if (!this.agentInstanceRepository) return;
    const existing = await this.agentInstanceRepository.findOne({ where: { id: meta.conversationId } });
    if (existing) {
      existing.name = meta.title || existing.name;
      existing.modified = new Date(meta.lastMessageTimestamp);
      await this.agentInstanceRepository.save(existing);
      return;
    }
    await this.agentInstanceRepository.save(this.agentInstanceRepository.create({
      id: meta.conversationId,
      agentDefId: meta.definitionId,
      name: meta.title || meta.definitionId,
      status: { state: 'completed', modified: new Date(meta.lastMessageTimestamp) },
      created: new Date(meta.lastMessageTimestamp),
      modified: new Date(meta.lastMessageTimestamp),
    }));
  }

  private async getMemeLoopOrchestrationTransport(): Promise<RemoteOrchestrationTransport> {
    await this.ensureMemeLoopWorkerHealthy();
    if (!this.memeLoopOrchestrationEndpoint) {
      throw new Error('MemeLoop orchestration endpoint is unavailable');
    }
    return createFetchOrchestrationTransport({
      endpoint: this.memeLoopOrchestrationEndpoint,
      headers: {
        Authorization: `Bearer ${this.memeLoopOrchestrationToken}`,
      },
    });
  }

  async requestOrchestration(
    request: RemoteOrchestrationRequest,
  ): Promise<RemoteOrchestrationResponse> {
    const transport = await this.getMemeLoopOrchestrationTransport();
    return transport.request(request);
  }

  subscribeToOrchestrationWatch(
    request: RemoteOrchestrationRequest,
  ): Observable<RemoteOrchestrationResponse> {
    return new Observable((subscriber) => {
      const abort = new AbortController();
      void (async () => {
        try {
          const transport = await this.getMemeLoopOrchestrationTransport();
          for await (
            const event of transport.watch(request, {
              signal: abort.signal,
            })
          ) {
            subscriber.next(event);
          }
          subscriber.complete();
        } catch (error) {
          if (!abort.signal.aborted) subscriber.error(error);
        }
      })();
      return () => {
        abort.abort();
      };
    });
  }

  private extractToolStepText(data: unknown): string {
    if (typeof data === 'string') return data;
    if (data == null) return '';
    if (typeof data === 'function') return data.name;
    if (typeof data === 'number' || typeof data === 'bigint' || typeof data === 'boolean') return data.toString();
    if (typeof data === 'symbol') return data.description ?? '';
    const anyData = data as Record<string, unknown>;
    if (typeof anyData.error === 'string' && anyData.error.length > 0) {
      return anyData.error;
    }
    if (typeof anyData.result === 'string' && anyData.result.length > 0) {
      return anyData.result;
    }
    if (typeof anyData.message === 'string' && anyData.message.length > 0) {
      return anyData.message;
    }
    if (typeof anyData.summary === 'string' && anyData.summary.length > 0) {
      return anyData.summary;
    }
    return JSON.stringify(data ?? '');
  }
  private workerConversationByAgentId: Map<string, string> = new Map();
  private workerConversationCleanupByAgentId: Map<string, () => void> = new Map();

  /** Serializes UtilityProcess ping/restart so concurrent agent turns do not race proxies. */
  private memeLoopWorkerMutex: Promise<void> = Promise.resolve();

  public async initialize(): Promise<void> {
    try {
      await this.initializeDatabase();
      // Build the host-owned preview/schema runtime explicitly. Importing a
      // tool module never mutates process state, so initialization order and
      // repeated service setup remain deterministic.
      await this.initializeFrameworks();
      // Restore definition heartbeats after DB + frameworks are ready.
      await this.restoreBackgroundTasks();
      // Restore unified ScheduledTaskManager tasks
      await this.restoreScheduledTaskManagerTasks();
    } catch (error) {
      logger.error('Failed to initialize agent instance service', { error });
      throw error;
    }
  }

  private async initializeDatabase(): Promise<void> {
    try {
      // Database is already initialized in the agent definition service
      this.dataSource = await this.databaseService.getDatabase('agent');
      this.agentInstanceRepository = this.dataSource.getRepository(AgentInstanceEntity);
      this.agentMessageRepository = this.dataSource.getRepository(
        AgentInstanceMessageEntity,
      );
      this.remoteScheduledTaskProjectionRepository = this.dataSource.getRepository(RemoteScheduledTaskProjectionEntity);

      // Initialize the unified ScheduledTaskManager
      const stmRepo = this.dataSource.getRepository(ScheduledTaskEntity);
      initScheduledTaskManager(stmRepo, this, async () => {
        const identity = this.memeLoopHostIdentity;
        if (!identity?.peerId) throw new Error('scheduled_task_identity_unavailable');
        return { peerId: identity.peerId, deviceName: identity.deviceName };
      });
      this.scheduledTaskRepositoryReady = true;

      logger.debug('AgentInstance repositories initialized');
    } catch (error) {
      logger.error('Failed to initialize agent instance database', { error });
      throw error;
    }
  }

  public async initializeFrameworks(): Promise<void> {
    this.agentToolRuntime?.dispose();
    this.frameworkSchemas.clear();
    this.agentToolRuntime = bootstrapAppAgentToolRuntime();
    this.frameworkSchemas.set(
      'memeloopTaskAgentWorker',
      getPromptConcatAgentFrameworkConfigJsonSchema(this.agentToolRuntime),
    );
    await this.ensureMemeLoopWorkerHealthy();
  }

  private async initializeMemeLoopWorker(): Promise<void> {
    if (!this.memeLoopHostIdentity) {
      throw new Error('MemeLoop UtilityProcess cannot start without the host DeviceNetwork identity');
    }
    if (this.memeLoopWorker || this.memeLoopUtilityProcess) return;
    const startupAbortController = new AbortController();
    this.memeLoopStartupAbortController = startupAbortController;
    let utilityProcess: UtilityProcess | undefined;
    try {
      await waitForElectronReady();
      startupAbortController.signal.throwIfAborted();
      const runtimeProcess = createMemeLoopUtilityProcess();
      utilityProcess = runtimeProcess;
      this.memeLoopUtilityProcess = runtimeProcess;
      const logLimiter = createUtilityProcessLogLimiter();
      const postToRuntime = (message: unknown): boolean => {
        if (this.memeLoopUtilityProcess !== runtimeProcess || runtimeProcess.pid === undefined) {
          return false;
        }
        return safePostMessage(runtimeProcess, message);
      };
      const postRuntimeReply = (
        message: unknown,
        id: string,
        errorType: string,
      ): boolean => {
        if (postToRuntime(message)) return true;
        // If a result is too large for structured clone, return a bounded
        // terminal error so the child never waits forever for a response.
        return postToRuntime({
          type: errorType,
          id,
          error: {
            message: 'memeloop_utility_process_response_too_large_or_not_cloneable',
            name: 'UtilityProcessTransportError',
          },
        });
      };
      runtimeProcess.on('message', (message: unknown) => {
        const m = message as {
          type?: string;
          id?: string;
          request?: unknown;
          toolId?: string;
          args?: Record<string, unknown>;
          method?: string;
          arguments?: unknown[];
        };

        if (m?.type === 'memeloop-scheduled-task-cancel' && m.id) {
          this.workerScheduledTaskCallAbortControllers.get(m.id)?.abort(new Error('scheduled_task_call_aborted'));
          return;
        }

        if (m?.type === 'memeloop-scheduled-task-call' && m.id && m.method && Array.isArray(m.arguments)) {
          const requestId = m.id;
          const method = m.method;
          const arguments_ = m.arguments;
          const controller = new AbortController();
          this.workerScheduledTaskCallAbortControllers.set(requestId, controller);
          void this.handleWorkerScheduledTaskCall(method, arguments_, controller.signal).then(
            result => {
              if (!controller.signal.aborted) {
                postRuntimeReply(
                  { type: 'memeloop-scheduled-task-call-result', id: requestId, result },
                  requestId,
                  'memeloop-scheduled-task-call-error',
                );
              }
            },
            (error: unknown) => {
              if (!controller.signal.aborted) {
                postRuntimeReply(
                  {
                    type: 'memeloop-scheduled-task-call-error',
                    id: requestId,
                    error: getWorkerErrorDetails(error),
                  },
                  requestId,
                  'memeloop-scheduled-task-call-error',
                );
              }
            },
          ).finally(() => {
            this.workerScheduledTaskCallAbortControllers.delete(requestId);
          }).catch((error: unknown) => {
            logger.debug('MemeLoop UtilityProcess scheduled callback ended after process exit', { error });
          });
          return;
        }

        if (m?.type === 'memeloop-tool-list' && m.id) {
          const requestId = m.id;
          try {
            postRuntimeReply(
              {
                type: 'memeloop-tool-list-result',
                id: requestId,
                tools: this.requireAgentToolRuntime().workerBridgeTools.listTools(),
              },
              requestId,
              'memeloop-tool-list-error',
            );
          } catch (error) {
            postRuntimeReply(
              {
                type: 'memeloop-tool-list-error',
                id: requestId,
                error: getWorkerErrorDetails(error),
              },
              requestId,
              'memeloop-tool-list-error',
            );
          }
          return;
        }

        if (m?.type === 'memeloop-tool-call' && m.id && m.toolId) {
          const requestId = m.id;
          const toolId = m.toolId;
          const callbackController = new AbortController();
          this.workerHostCallbackAbortControllers.set(requestId, callbackController);
          void (async () => {
            try {
              const result = await this.requireAgentToolRuntime().workerBridgeTools.execute(
                toolId,
                m.args ?? {},
              );
              if (!callbackController.signal.aborted) {
                postRuntimeReply(
                  {
                    type: 'memeloop-tool-call-result',
                    id: requestId,
                    result,
                  },
                  requestId,
                  'memeloop-tool-call-error',
                );
              }
            } catch (error) {
              if (!callbackController.signal.aborted) {
                postRuntimeReply(
                  {
                    type: 'memeloop-tool-call-error',
                    id: requestId,
                    error: getWorkerErrorDetails(error),
                  },
                  requestId,
                  'memeloop-tool-call-error',
                );
              }
            } finally {
              this.workerHostCallbackAbortControllers.delete(requestId);
            }
          })().catch((error: unknown) => {
            logger.debug('MemeLoop UtilityProcess tool callback ended after process exit', { error });
          });
          return;
        }

        if (m?.type === 'memeloop-llm-chat' && m.id) {
          const requestId = m.id;
          const request = m.request as {
            conversationId?: string;
            messages?: ModelMessage[];
          };
          const callbackController = new AbortController();
          this.workerHostCallbackAbortControllers.set(requestId, callbackController);
          void (async () => {
            try {
              const conversationId = request.conversationId;
              const mappedAgentId = conversationId
                ? this.workerAgentIdByConversationId.get(conversationId)
                : undefined;
              // Core is the only prompt/context assembler. Preserve the exact
              // bounded ModelMessage sequence (including tool and multimodal
              // parts) and let this host adapter do transport only.
              const modelMessages = request.messages ?? [];

              const providerRegistryService = container.get<IProviderRegistryService>(
                serviceIdentifier.ProviderRegistry,
              );
              const aiConfig = await providerRegistryService.getModelAssignments();
              logger.warn('memeloop-llm-chat request prepared', {
                conversationId,
                agentId: mappedAgentId,
                messageCount: modelMessages.length,
                hasNonStringContent: modelMessages.some(
                  (message_) => typeof message_.content !== 'string',
                ),
              });
              const generator = providerRegistryService.generateFromAI(
                modelMessages,
                aiConfig,
                {
                  agentInstanceId: conversationId,
                },
              );
              let previousSnapshot = '';
              for await (const event of generator) {
                logger.warn('memeloop-llm-chat event', {
                  conversationId,
                  status: event?.status,
                  hasContent: event?.content !== undefined && event?.content !== null,
                  contentType: typeof event?.content,
                  contentPreview: typeof event?.content === 'string'
                    ? event.content.slice(0, 120)
                    : undefined,
                });
                if (event?.status === 'error') {
                  const message_ = event.content;
                  throw new Error(message_);
                }
                if (event?.status === 'update' || event?.status === 'done') {
                  if (event?.content !== undefined && event?.content !== null) {
                    const snapshot = event.content;
                    const delta = snapshot.startsWith(previousSnapshot)
                      ? snapshot.slice(previousSnapshot.length)
                      : snapshot;
                    previousSnapshot = snapshot;
                    if (delta && !callbackController.signal.aborted) {
                      postRuntimeReply(
                        {
                          type: 'memeloop-llm-chat-delta',
                          id: requestId,
                          delta,
                        },
                        requestId,
                        'memeloop-llm-chat-error',
                      );
                    }
                  }
                }
              }
              if (!callbackController.signal.aborted) {
                postRuntimeReply(
                  { type: 'memeloop-llm-chat-done', id: requestId },
                  requestId,
                  'memeloop-llm-chat-error',
                );
              }
            } catch (error) {
              if (!callbackController.signal.aborted) {
                postRuntimeReply(
                  {
                    type: 'memeloop-llm-chat-error',
                    id: requestId,
                    error: getWorkerErrorDetails(error),
                  },
                  requestId,
                  'memeloop-llm-chat-error',
                );
              }
            } finally {
              this.workerHostCallbackAbortControllers.delete(requestId);
            }
          })().catch((error: unknown) => {
            logger.debug('MemeLoop UtilityProcess LLM callback ended after process exit', { error });
          });
          return;
        }
      });
      runtimeProcess.on('error', (type: 'FatalError', location: string, report: string) => {
        if (!logLimiter.allow()) return;
        logger.error('MemeLoop UtilityProcess error', {
          type,
          location: logLimiter.text(location),
          report: logLimiter.text(report),
        });
      });
      runtimeProcess.on('exit', (code) => {
        if (this.memeLoopUtilityProcess !== runtimeProcess) return;
        const exitError = new Error(`MemeLoop UtilityProcess exited with code ${code}`);
        this.abortUtilityProcessHostCallbacks(exitError);
        this.memeLoopWorkerLogCleanup?.();
        this.memeLoopWorkerLogCleanup = undefined;
        this.detachCrashedWorkerConversations();
        this.memeLoopUtilityProcess = undefined;
        this.memeLoopWorker = undefined;
        this.memeLoopOrchestrationEndpoint = undefined;
        if (code === 0) logger.info('MemeLoop UtilityProcess exited', { code });
        else logger.error('MemeLoop UtilityProcess crashed', { code });
      });
      runtimeProcess.stdout?.on('data', (data: unknown) => {
        if (logLimiter.allow()) {
          logger.debug('MemeLoop UtilityProcess stdout', { output: logLimiter.text(data) });
        }
      });
      runtimeProcess.stderr?.on('data', (data: unknown) => {
        if (logLimiter.allow()) {
          logger.warn('MemeLoop UtilityProcess stderr', { output: logLimiter.text(data) });
        }
      });
      await waitForUtilityProcessSpawn(runtimeProcess, startupAbortController.signal);
      startupAbortController.signal.throwIfAborted();
      this.memeLoopWorker = createWorkerProxy<MemeLoopWorker>(runtimeProcess, {
        observableMethods: [
          'subscribeLogs',
          'subscribeToUpdates',
          'subscribeConversationMutations',
        ],
      });
      await this.memeLoopWorker.configureHost({
        dataDir: path.join(USER_DATA_FOLDER, 'memeloop'),
        sqliteNativeBinding: SQLITE_BINARY_PATH,
        orchestrationAccessToken: this.memeLoopOrchestrationToken,
        localPeerId: this.memeLoopHostIdentity.peerId,
      });

      // Subscribe UtilityProcess logs via the standard workerAdapter protocol.
      this.memeLoopWorkerLogCleanup?.();
      try {
        const subscription = this.memeLoopWorker.subscribeLogs().subscribe({
          next: event => {
            const metadata = { meta: event.meta };
            if (event.level === 'warn') logger.warn(event.message, metadata);
            else if (event.level === 'error') logger.error(event.message, metadata);
            else if (event.level === 'debug') logger.debug(event.message, metadata);
            else logger.info(event.message, metadata);
          },
          error: (error: unknown) => {
            logger.error('MemeLoop UtilityProcess log stream failed', { error });
          },
        });
        this.memeLoopWorkerLogCleanup = () => {
          subscription.unsubscribe();
        };
      } catch (error) {
        logger.warn('Failed to subscribe MemeLoop UtilityProcess logs', { error });
      }

      const ping = await Promise.race([
        this.memeLoopWorker.ping(),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => {
              reject(new Error('MemeLoop UtilityProcess initial ping timeout'));
            },
            MEMELOOP_UTILITY_PROCESS_INITIALIZATION_TIMEOUT_MS,
          );
        }),
      ]);
      const server = await this.memeLoopWorker.startServer(0);
      if (!server.running || !server.port) {
        throw new Error('MemeLoop UtilityProcess orchestration server did not start');
      }
      this.memeLoopOrchestrationEndpoint = `http://127.0.0.1:${server.port}/v2/orchestration/resources`;
      // A crashed process invalidates only its subscriptions, not the durable
      // Core conversation IDs. Rebind every surviving conversation before
      // exposing the replacement process as healthy.
      for (const [agentId, conversationId] of this.workerConversationByAgentId) {
        this.bindWorkerConversation(agentId, conversationId);
      }
      logger.info('MemeLoop UtilityProcess initialized', {
        ...ping,
        orchestrationEndpoint: this.memeLoopOrchestrationEndpoint,
      });
    } catch (error) {
      logger.error('Failed to initialize MemeLoop UtilityProcess', { error });
      startupAbortController.abort(error instanceof Error ? error : new Error(String(error)));
      if (utilityProcess && this.memeLoopUtilityProcess === utilityProcess) {
        this.memeLoopUtilityProcess = undefined;
        this.memeLoopWorker = undefined;
        this.memeLoopOrchestrationEndpoint = undefined;
        try {
          utilityProcess.kill();
        } catch (killError) {
          logger.warn('Failed to kill failed MemeLoop UtilityProcess', { killError });
        }
      }
      throw error;
    } finally {
      if (this.memeLoopStartupAbortController === startupAbortController) {
        this.memeLoopStartupAbortController = undefined;
      }
    }
  }

  private async handleWorkerScheduledTaskCall(
    method: string,
    arguments_: unknown[],
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    switch (method) {
      case 'createScheduledTask':
        return this.createScheduledTask(arguments_[0] as CreateScheduledTaskInput, { signal });
      case 'updateScheduledTaskScoped':
        return this.updateScheduledTaskScoped(
          arguments_[0] as ScheduledTaskScope,
          arguments_[1] as UpdateScheduledTaskInput,
          { signal },
        );
      case 'deleteScheduledTaskScoped':
        return this.deleteScheduledTaskScoped(arguments_[0] as ScheduledTaskScope, { signal });
      case 'getScheduledTaskByScope':
        return this.getScheduledTaskByScope(arguments_[0] as ScheduledTaskScope, { signal });
      case 'listScheduledTasksPageForAgent':
        return this.listScheduledTasksPageForAgent({
          ...(arguments_[0] as ListScheduledTasksPageForAgentInput),
          signal,
        });
      case 'listRemoteScheduledTaskProjectionPageForAgent':
        return this.listRemoteScheduledTaskProjectionPageForAgent(
          arguments_[0] as ListRemoteScheduledTaskProjectionPageInput,
        );
      case 'getCronPreviewDates':
        signal.throwIfAborted();
        return this.getCronPreviewDates(
          arguments_[0] as string,
          arguments_[1] as string | undefined,
          arguments_[2] as number | undefined,
        );
      default:
        throw new Error(`scheduled_task_worker_method_not_supported:${method}`);
    }
  }

  /**
   * Ensures the UtilityProcess exists and responds to ping; on failure disposes
   * and recreates it. Caller should treat this as required before any
   * `memeLoopWorker` protocol RPC (serialized via mutex).
   */
  private async ensureMemeLoopWorkerHealthy(): Promise<void> {
    const previous = this.memeLoopWorkerMutex;
    let release!: () => void;
    this.memeLoopWorkerMutex = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      if (!this.memeLoopWorker) {
        await this.initializeMemeLoopWorker();
        return;
      }
      try {
        await Promise.race([
          this.memeLoopWorker.ping(),
          new Promise<never>((_, reject) => {
            setTimeout(
              () => {
                reject(new Error('MemeLoop UtilityProcess ping timeout'));
              },
              5000,
            );
          }),
        ]);
      } catch (error: unknown) {
        logger.warn('MemeLoop UtilityProcess unhealthy; restarting process', {
          error,
        });
        await this.disposeMemeLoopWorker();
        await this.initializeMemeLoopWorker();
      }
    } finally {
      release();
    }
  }

  /** Restore definition heartbeats; durable scheduled tasks are restored by the
   * canonical ScheduledTask manager below. */
  private async restoreBackgroundTasks(): Promise<void> {
    if (!this.agentInstanceRepository) return;
    try {
      // Find all non-closed, non-volatile agent instances with their definitions
      const activeInstances = await this.agentInstanceRepository.find({
        where: { closed: false, volatile: false },
        relations: { agentDefinition: true },
      });

      let heartbeatsRestored = 0;

      for (const instance of activeInstances) {
        // Restore heartbeat from definition
        const heartbeatConfig = instance.agentDefinition?.heartbeat;
        if (heartbeatConfig?.enabled) {
          startHeartbeat(instance.id, heartbeatConfig, this, {
            createdBy: 'agent-definition',
          });
          heartbeatsRestored++;
        }
      }

      if (heartbeatsRestored > 0) {
        logger.info('Background tasks restored', {
          heartbeatsRestored,
          totalInstances: activeInstances.length,
        });
      }
    } catch (error) {
      logger.error('Failed to restore background tasks', { error });
    }
  }

  /**
   * Restore unified ScheduledTaskManager tasks from DB after app restart.
   */
  private async restoreScheduledTaskManagerTasks(): Promise<void> {
    if (!this.scheduledTaskRepositoryReady || !this.agentInstanceRepository) {
      return;
    }
    try {
      const { ScheduledTaskEntity } = await import('@services/database/schema/agent');
      const stmRepo = this.dataSource!.getRepository(ScheduledTaskEntity);

      const isVolatile = async (agentInstanceId: string): Promise<boolean> => {
        const entity = await this.agentInstanceRepository!.findOne({
          where: { id: agentInstanceId },
        });
        return entity?.volatile ?? true;
      };

      await restoreScheduledTasks(stmRepo, isVolatile);
    } catch (error) {
      logger.error('Failed to restore ScheduledTaskManager tasks', { error });
    }
  }

  /**
   * Ensure repositories are initialized
   */
  private ensureRepositories(): void {
    if (!this.agentInstanceRepository || !this.agentMessageRepository) {
      throw new Error('Agent instance repositories not initialized');
    }
  }

  /**
   * Clean up subscriptions for specific agent
   */
  private cleanupAgentSubscriptions(agentId: string): void {
    if (this.agentInstanceSubjects.has(agentId)) {
      this.agentInstanceSubjects.delete(agentId);
    }
  }

  public async createAgent(
    agentDefinitionID?: string,
    options?: { preview?: boolean; volatile?: boolean },
  ): Promise<AgentInstance> {
    this.ensureRepositories();
    try {
      const created = await repo.createAgent(
        this.agentInstanceRepository!,
        this.agentDefinitionService,
        agentDefinitionID,
        options,
      );
      // Don't block the agent tab creation UI on UtilityProcess conversation initialization.
      // Worker conversation binding may take time (or fail), but the agent instance can still be created.
      void this.ensureWorkerConversation(created.id, created.agentDefId);
      return created;
    } catch (error) {
      logger.error('Failed to create agent instance', { error });
      throw error;
    }
  }

  public async getAgentMetadata(agentId: string): Promise<AgentInstanceMetadata | undefined> {
    this.ensureRepositories();
    return repo.getAgentMetadata(this.agentInstanceRepository!, agentId);
  }

  private async callLocalAgentDeviceRpc<T>(method: string, parameters: unknown): Promise<T> {
    const worker = await this.getMemeLoopWorkerProxy();
    return await worker.handleLocalDeviceRpc({
      remotePeerId: this.requireMemeLoopHostPeerId(),
      method,
      parameters,
    }) as T;
  }

  public async getAgentConversationMessagePage(
    conversationId: string,
    options: AgentConversationMessagePageOptions,
  ): Promise<AgentConversationMessagePage> {
    return this.callLocalAgentDeviceRpc(AGENT_DEVICE_RPC_METHODS.getMessagePage, {
      conversationId,
      limit: options.limit,
      maxBytes: options.maxBytes,
      ...(options.direction === undefined ? {} : { direction: options.direction }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
      ...(options.expectedRevision === undefined ? {} : { expectedRevision: options.expectedRevision }),
    });
  }

  public async getAgentConversationMessageWindow(
    request: AgentConversationMessageWindowRequest,
  ): Promise<AgentConversationMessageWindowResult> {
    return this.callLocalAgentDeviceRpc(AGENT_DEVICE_RPC_METHODS.loadAround, {
      conversationId: request.conversationId,
      focus: request.focus,
      expectedRevision: request.expectedRevision,
      maxMessages: request.maxMessages,
      maxBytes: request.maxBytes,
    });
  }

  public async getAgentConversationTimelinePage(
    request: AgentDeviceRpcGetConversationTimelinePageRequest,
  ): Promise<ConversationTimelinePage> {
    return this.callLocalAgentDeviceRpc(
      AGENT_DEVICE_RPC_METHODS.getConversationTimelinePage,
      request,
    );
  }

  public async getAgentConversationTurnDetail(
    request: AgentDeviceRpcGetTurnDetailRequest,
  ): Promise<AgentDeviceRpcGetTurnDetailResponse> {
    return this.callLocalAgentDeviceRpc(AGENT_DEVICE_RPC_METHODS.getTurnDetail, request);
  }

  public async getAgentConversationMessageDetail(
    request: AgentDeviceRpcGetMessageDetailRequest,
  ): Promise<AgentDeviceRpcGetMessageDetailResponse> {
    return this.callLocalAgentDeviceRpc(AGENT_DEVICE_RPC_METHODS.getMessageDetail, request);
  }

  public async exportAgentMessage(
    request: ExportAgentMessageRequest,
  ): Promise<ExportAgentMessageResult> {
    if (!request.conversationId || !request.messageId || !request.requestId) {
      throw new Error('invalid_agent_message_export_request');
    }
    if (this.messageExportAbortControllers.has(request.requestId)) {
      throw new Error('duplicate_agent_message_export_request');
    }
    const abortController = new AbortController();
    this.messageExportAbortControllers.set(request.requestId, abortController);
    try {
      const safeMessageId = request.messageId.replaceAll(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'message';
      const selection = await dialog.showSaveDialog({
        defaultPath: `memeloop-${safeMessageId}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      abortController.signal.throwIfAborted();
      if (selection.canceled || !selection.filePath) return { saved: false };

      const firstRange = await this.callMemeLoopWorkerStorage<ConversationMessageDetailRange>(
        'readMessageDetailRange',
        request.conversationId,
        request.messageId,
        0,
        AGENT_MESSAGE_EXPORT_CHUNK_BYTES,
      );
      abortController.signal.throwIfAborted();
      if (!firstRange.found) throw new Error('agent_message_export_not_found');
      if (firstRange.totalBytes > AGENT_MESSAGE_EXPORT_MAX_BYTES) {
        throw new Error('agent_message_export_exceeds_64_mib');
      }

      const file = await open(selection.filePath, 'w');
      try {
        let firstPending = true;
        const result = await streamAgentMessageDetailRanges({
          signal: abortController.signal,
          readRange: async (offset, maximumBytes) => {
            if (firstPending && offset === 0) {
              firstPending = false;
              return firstRange;
            }
            return this.callMemeLoopWorkerStorage<ConversationMessageDetailRange>(
              'readMessageDetailRange',
              request.conversationId,
              request.messageId,
              offset,
              maximumBytes,
            );
          },
          sink: {
            write: async bytes => {
              let written = 0;
              while (written < bytes.byteLength) {
                abortController.signal.throwIfAborted();
                const result = await file.write(bytes, written, bytes.byteLength - written, null);
                if (result.bytesWritten <= 0) throw new Error('agent_message_export_sink_stalled');
                written += result.bytesWritten;
              }
            },
          },
        });
        return { saved: true, bytesWritten: result.bytesWritten };
      } finally {
        await file.close();
      }
    } finally {
      if (this.messageExportAbortControllers.get(request.requestId) === abortController) {
        this.messageExportAbortControllers.delete(request.requestId);
      }
    }
  }

  public async cancelAgentMessageExport(requestId: string): Promise<void> {
    this.messageExportAbortControllers.get(requestId)?.abort(
      new DOMException('Message export was cancelled', 'AbortError'),
    );
  }

  public async deleteAgentTurn(
    request: AgentDeviceRpcDeleteTurnRequest,
  ): Promise<AgentDeviceRpcDeleteTurnResponse> {
    return this.callLocalAgentDeviceRpc(AGENT_DEVICE_RPC_METHODS.deleteTurn, request);
  }

  public async retryAgentTurn(
    request: AgentDeviceRpcRetryTurnRequest,
  ): Promise<AgentDeviceRpcRetryTurnResponse> {
    this.workerActiveTurnIdByConversationId.set(request.conversationId, request.newTurnId);
    try {
      return await this.callLocalAgentDeviceRpc(
        AGENT_DEVICE_RPC_METHODS.retryTurn,
        request,
      );
    } catch (error) {
      if (this.workerActiveTurnIdByConversationId.get(request.conversationId) === request.newTurnId) {
        this.workerActiveTurnIdByConversationId.delete(request.conversationId);
      }
      throw error;
    }
  }

  public async retryAgentTurnAndWait(
    request: AgentDeviceRpcRetryTurnRequest,
  ): Promise<AgentDeviceRpcRetryTurnResponse> {
    const response = await this.retryAgentTurn(request);
    await this.ensureMemeLoopWorkerHealthy();
    if (!this.memeLoopWorker) throw new Error('MemeLoop runtime is unavailable');
    this.workerActiveRunIdByConversationId.set(request.conversationId, response.runId);
    try {
      await this.memeLoopWorker.waitForRunTerminal(response.runId);
      return response;
    } finally {
      if (this.workerActiveRunIdByConversationId.get(request.conversationId) === response.runId) {
        this.workerActiveRunIdByConversationId.delete(request.conversationId);
      }
      if (this.workerActiveTurnIdByConversationId.get(request.conversationId) === request.newTurnId) {
        this.workerActiveTurnIdByConversationId.delete(request.conversationId);
      }
    }
  }

  public async beginAgentAttachmentUpload(
    request: BeginAttachmentUploadRequest,
  ): Promise<BeginAttachmentUploadResponse> {
    return this.callLocalAgentDeviceRpc(AGENT_DEVICE_RPC_METHODS.beginAttachmentUpload, request);
  }

  public async uploadAgentAttachmentChunk(
    request: UploadAttachmentChunkRequest,
  ): Promise<UploadAttachmentChunkResponse> {
    return this.callLocalAgentDeviceRpc(AGENT_DEVICE_RPC_METHODS.uploadAttachmentChunk, request);
  }

  public async commitAgentAttachmentUpload(
    request: CommitAttachmentUploadRequest,
  ): Promise<CommitAttachmentUploadResponse> {
    return this.callLocalAgentDeviceRpc(AGENT_DEVICE_RPC_METHODS.commitAttachmentUpload, request);
  }

  public async preparePromptPreviewExecution(
    request: PreparePromptPreviewExecutionRequest,
  ): Promise<PromptPreviewPreparedExecution> {
    const worker = await this.getMemeLoopWorkerProxy();
    return worker.preparePromptPreviewExecution(request);
  }

  public async getPromptPreviewAuditPage(
    request: PromptPreviewAuditPageRequest,
  ): Promise<PromptPreviewAuditPage> {
    const worker = await this.getMemeLoopWorkerProxy();
    return worker.getPromptPreviewAuditPage(request);
  }

  public async getPromptPreviewAuditDetail(
    request: PromptPreviewAuditDetailRequest,
  ): Promise<PromptPreviewAuditDetailChunk> {
    const worker = await this.getMemeLoopWorkerProxy();
    return worker.getPromptPreviewAuditDetail(request);
  }

  public async releasePromptPreviewAuditSession(
    request: PromptPreviewAuditReleaseRequest,
  ): Promise<void> {
    const worker = await this.getMemeLoopWorkerProxy();
    await worker.releasePromptPreviewAuditSession(request);
  }

  public async cancelPromptPreview(requestId: string): Promise<void> {
    const worker = await this.getMemeLoopWorkerProxy();
    await worker.cancelPromptPreview(requestId);
  }

  public async updateAgent(
    agentId: string,
    data: Partial<AgentInstance>,
  ): Promise<AgentInstance> {
    this.ensureRepositories();
    try {
      const updatedAgent = await repo.updateAgent(
        this.agentInstanceRepository!,
        this.agentMessageRepository!,
        this.agentDefinitionService,
        agentId,
        data,
      );
      const metadata = await this.getAgentMetadata(agentId);
      if (!metadata) throw new Error(`Agent instance not found: ${agentId}`);
      this.notifyAgentUpdate(agentId, metadata, updatedAgent.messages[0]);
      return updatedAgent;
    } catch (error) {
      logger.error('Failed to update agent instance', { error });
      throw error;
    }
  }

  public async deleteAgent(agentId: string): Promise<void> {
    this.ensureRepositories();
    try {
      stopHeartbeat(agentId);
      await deleteTasksForAgent(agentId);
      await cleanupMCPClient(agentId);
      await this.cancelWorkerConversation(agentId);
      await repo.deleteAgent(
        this.agentInstanceRepository!,
        this.agentMessageRepository!,
        agentId,
      );
      this.cleanupAgentSubscriptions(agentId);
      this.cleanupWorkerConversation(agentId);
      this.workerConversationByAgentId.delete(agentId);
    } catch (error) {
      logger.error('Failed to delete agent instance', { error });
      throw error;
    }
  }

  public async getAgents(
    page: number,
    pageSize: number,
    options?: { closed?: boolean; searchName?: string },
  ): Promise<AgentInstanceMetadata[]> {
    this.ensureRepositories();
    try {
      return await repo.getAgents(
        this.agentInstanceRepository!,
        page,
        pageSize,
        options,
      );
    } catch (error) {
      logger.error('Failed to get agent instances', { error });
      throw error;
    }
  }

  public async sendMsgToAgent(
    agentId: string,
    content: {
      text: string;
      attachment?: AttachmentReference;
    },
  ): Promise<void> {
    try {
      const agent = await this.getAgentMetadata(agentId);
      if (!agent) throw new Error(`Agent instance not found: ${agentId}`);
      const conversationId = await this.ensureWorkerConversation(agentId, agent.agentDefId);
      if (!conversationId || !this.memeLoopWorker) throw new Error('MemeLoop runtime is unavailable');
      const turnId = nanoid();
      const userMessage = await this.prepareCanonicalUserMessage(conversationId, turnId, content);
      this.workerActiveTurnIdByConversationId.set(conversationId, turnId);
      const accepted = await this.memeLoopWorker.sendMessage(conversationId, content.text, {
        requestId: `${turnId}:local`,
        turnId,
        userMessage,
      });
      if (!accepted?.runId) throw new Error('MemeLoop runtime did not return a durable run id');
      this.workerActiveRunIdByConversationId.set(conversationId, accepted.runId);
      const definition = await this.agentDefinitionService.getAgentDef(agent.agentDefId);
      if (definition?.heartbeat?.enabled && !agent.volatile) {
        startHeartbeat(agentId, definition.heartbeat, this, { createdBy: 'agent-definition' });
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to send message to agent: ${errorMessage}`);
      throw error;
    }
  }

  public async executeAgentTurn(
    request: AgentDeviceRpcRunTurnRequest,
  ): Promise<AgentDeviceRpcTurnAcceptedResponse> {
    assertAgentDeviceRpcRequest(AGENT_DEVICE_RPC_METHODS.runTurn, request);
    const agent = await this.getAgentMetadata(request.conversationId);
    if (!agent) throw new Error('agent_execution_conversation_not_found');
    if (agent.agentDefId !== request.definitionId) {
      throw new Error('agent_execution_definition_mismatch');
    }
    const conversationId = await this.ensureWorkerConversation(agent.id, agent.agentDefId);
    await this.ensureMemeLoopWorkerHealthy();
    if (conversationId !== request.conversationId || !this.memeLoopWorker) {
      throw new Error('agent_execution_conversation_mismatch');
    }
    const userMessage = {
      ...request.userMessage,
      messageId: request.turnId,
      turnId: request.turnId,
      conversationId,
      content: request.userMessage?.content ?? request.message,
    };
    this.workerActiveTurnIdByConversationId.set(conversationId, request.turnId);
    let runId: string | undefined;
    try {
      const accepted = await this.memeLoopWorker.sendMessage(
        conversationId,
        request.message,
        {
          requestId: request.requestId,
          turnId: request.turnId,
          userMessage,
        },
      );
      if (
        !accepted?.runId ||
        accepted.conversationId !== request.conversationId ||
        accepted.turnId !== request.turnId
      ) throw new Error('agent_execution_acceptance_mismatch');
      runId = accepted.runId;
      this.workerActiveRunIdByConversationId.set(conversationId, runId);
      const definition = await this.agentDefinitionService.getAgentDef(agent.agentDefId);
      if (definition?.heartbeat?.enabled && !agent.volatile) {
        startHeartbeat(agent.id, definition.heartbeat, this, { createdBy: 'agent-definition' });
      }
      await this.memeLoopWorker.waitForRunTerminal(runId);
      return {
        ok: true,
        state: 'accepted',
        runId,
        conversationId,
        requestId: request.requestId,
        turnId: request.turnId,
      };
    } finally {
      if (runId && this.workerActiveRunIdByConversationId.get(conversationId) === runId) {
        this.workerActiveRunIdByConversationId.delete(conversationId);
      }
      if (this.workerActiveTurnIdByConversationId.get(conversationId) === request.turnId) {
        this.workerActiveTurnIdByConversationId.delete(conversationId);
      }
    }
  }

  public async runScheduledTaskAgent(
    agentId: string,
    message: string,
    options: {
      occurrenceId: string;
      scheduledFor: string;
      attempt: number;
      signal: AbortSignal;
    },
  ): Promise<void> {
    if (!options.occurrenceId || options.occurrenceId.length > 256) {
      throw new Error('scheduled_agent_occurrence_id_invalid');
    }
    if (!Number.isSafeInteger(options.attempt) || options.attempt < 0) {
      throw new Error('scheduled_agent_attempt_invalid');
    }
    const scheduledFor = new Date(options.scheduledFor);
    if (!Number.isFinite(scheduledFor.getTime()) || scheduledFor.toISOString() !== options.scheduledFor) {
      throw new Error('scheduled_agent_occurrence_time_invalid');
    }
    options.signal.throwIfAborted();
    const agent = await this.getAgentMetadata(agentId);
    if (!agent) throw new Error('scheduled_task_agent_unavailable');
    if (agent.volatile) throw new Error('scheduled_task_volatile_agent');
    const conversationId = await this.ensureWorkerConversation(agentId, agent.agentDefId);
    await this.ensureMemeLoopWorkerHealthy();
    if (!conversationId || !this.memeLoopWorker) throw new Error('MemeLoop runtime is unavailable');

    const stableAttemptId = `${options.occurrenceId}:attempt:${options.attempt}`;
    const prepared = await this.prepareCanonicalUserMessage(conversationId, stableAttemptId, { text: message });
    const userMessage = {
      ...prepared,
      metadata: {
        ...prepared.metadata,
        scheduledTask: {
          occurrenceId: options.occurrenceId,
          scheduledFor: options.scheduledFor,
          attempt: options.attempt,
        },
      },
    };
    let runId: string | undefined;
    const cancelAcceptedRun = (): void => {
      if (!runId || !this.memeLoopWorker) return;
      void this.memeLoopWorker.cancelRun(conversationId, runId).catch((error: unknown) => {
        logger.warn('Failed to cancel aborted scheduled Agent run', { error, agentId, runId });
      });
    };
    options.signal.addEventListener('abort', cancelAcceptedRun, { once: true });
    try {
      const accepted = await this.memeLoopWorker.sendMessage(conversationId, message, {
        requestId: stableAttemptId,
        turnId: stableAttemptId,
        userMessage,
      });
      if (!accepted?.runId) throw new Error('MemeLoop runtime did not return a durable run id');
      runId = accepted.runId;
      this.workerActiveTurnIdByConversationId.set(conversationId, stableAttemptId);
      this.workerActiveRunIdByConversationId.set(conversationId, runId);
      if (options.signal.aborted) {
        cancelAcceptedRun();
        options.signal.throwIfAborted();
      }
      await this.memeLoopWorker.waitForRunTerminal(runId);
      options.signal.throwIfAborted();
    } finally {
      options.signal.removeEventListener('abort', cancelAcceptedRun);
      if (runId && this.workerActiveRunIdByConversationId.get(conversationId) === runId) {
        this.workerActiveRunIdByConversationId.delete(conversationId);
      }
      if (this.workerActiveTurnIdByConversationId.get(conversationId) === stableAttemptId) {
        this.workerActiveTurnIdByConversationId.delete(conversationId);
      }
    }
  }

  private async prepareCanonicalUserMessage(
    conversationId: string,
    turnId: string,
    content: {
      text: string;
      attachment?: AttachmentReference;
    },
  ): Promise<Partial<ChatMessage> & { messageId: string; turnId: string; content: string }> {
    const attachments: AttachmentReference[] = [];
    if (content.attachment) attachments.push(content.attachment);
    return {
      messageId: turnId,
      turnId,
      conversationId,
      content: content.text,
      ...(attachments.length > 0 ? { attachments } : {}),
    };
  }

  public async cancelAgent(agentId: string): Promise<void> {
    stopHeartbeat(agentId);
    const workerConversationId = this.workerConversationByAgentId.get(agentId);
    if (!workerConversationId) return;
    await this.ensureMemeLoopWorkerHealthy();
    if (!this.memeLoopWorker) throw new Error('MemeLoop runtime is unavailable');
    const runId = this.workerActiveRunIdByConversationId.get(workerConversationId);
    await this.memeLoopWorker.cancelRun(workerConversationId, runId);
  }

  public async closeAgent(agentId: string): Promise<void> {
    this.ensureRepositories();

    try {
      stopHeartbeat(agentId);
      await cancelTasksForAgent(agentId);
      await cleanupMCPClient(agentId);
      await this.cancelWorkerConversation(agentId);
      this.cleanupWorkerConversation(agentId);
      this.workerConversationByAgentId.delete(agentId);

      // Get agent instance
      const instanceEntity = await this.agentInstanceRepository!.findOne({
        where: { id: agentId },
      });

      if (!instanceEntity) {
        throw new Error(`Agent instance not found: ${agentId}`);
      }

      // Mark as closed
      instanceEntity.closed = true;
      await this.agentInstanceRepository!.save(instanceEntity);

      // Clean up subscriptions
      this.cleanupAgentSubscriptions(agentId);

      logger.info('Closed agent instance', {
        function: 'closeAgent',
        agentId,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to close agent instance', {
        function: 'closeAgent',
        error: errorMessage,
      });
      throw error;
    }
  }

  private async ensureWorkerConversation(
    agentId: string,
    definitionId: string,
  ): Promise<string | undefined> {
    try {
      await this.ensureMemeLoopWorkerHealthy();
    } catch (error) {
      logger.error('Failed to ensure MemeLoop UtilityProcess conversation', {
        agentId,
        definitionId,
        error,
      });
      return undefined;
    }
    if (!this.memeLoopWorker) return undefined;
    const existing = this.workerConversationByAgentId.get(agentId);
    if (existing) {
      if (!this.workerConversationCleanupByAgentId.has(agentId)) {
        this.bindWorkerConversation(agentId, existing);
      }
      return existing;
    }
    try {
      // The host agent id is the durable Core conversation id. Reusing it is
      // idempotent, so a worker restart resumes the same SQLite history instead
      // of silently starting a context-free conversation.
      const created: unknown = await this.memeLoopWorker.createAgent(
        definitionId,
        undefined,
        agentId,
      );
      if (
        created &&
        typeof created === 'object' &&
        'conversationId' in created &&
        typeof created.conversationId === 'string'
      ) {
        const { conversationId } = created;
        this.workerConversationByAgentId.set(agentId, conversationId);
        this.bindWorkerConversation(agentId, conversationId);
        return conversationId;
      }
    } catch (error) {
      logger.error('Failed to create MemeLoop UtilityProcess conversation', {
        agentId,
        definitionId,
        error,
      });
    }
    return undefined;
  }

  /**
   * Build the canonical message shape used by live worker projections.
   * Stream updates are intentionally not persisted here, but they still cross
   * the service boundary and therefore must carry Core's provenance fields.
   */
  private createWorkerProjectionMessage(input: {
    conversationId: string;
    messageId: string;
    turnId: string | undefined;
    role: ChatMessage['role'];
    content: string;
  }): ChatMessage | undefined {
    const { conversationId, messageId, turnId, role, content } = input;
    const originNodeId = this.memeLoopHostIdentity?.peerId;
    if (!turnId || !originNodeId) return undefined;
    const timestamp = Date.now();
    return createChatMessage({
      messageId,
      turnId,
      conversationId,
      role,
      content,
      originNodeId,
      originSequence: timestamp,
      timestamp,
      lamportClock: timestamp,
    });
  }

  private bindWorkerConversation(
    agentId: string,
    conversationId: string,
  ): void {
    if (!this.memeLoopWorker) return;
    if (this.workerConversationCleanupByAgentId.has(agentId)) return;
    try {
      logger.warn('MemeLoop bindWorkerConversation subscribed', {
        agentId,
        conversationId,
      });
      this.workerAgentIdByConversationId.set(conversationId, agentId);
      // Keep a stable assistant message id while streaming text deltas.
      let assistantMessageId: string | undefined;
      let assistantBuffer = '';
      let lastWasAssistantMessage = false;

      const subscription = this.memeLoopWorker
        .subscribeToUpdates(conversationId)
        .subscribe({
          next: (payload: unknown) => {
            const raw = payload as {
              update?: {
                type?: string;
                // Custom events we emit from worker.
                payload?: unknown;
                error?: string;
                step?: { type?: string; data?: unknown };
              };
            };
            const updateType = raw?.update?.type;
            if (!updateType) return;
            // Debug hook: verify whether MemeLoop emits ask-question/tool-approval updates.
            // Keep this log short to avoid huge log files in e2e.
            logger.warn('MemeLoop UtilityProcess update received', {
              agentId,
              conversationId,
              updateType,
              hasPayload: Boolean(raw?.update?.payload),
              stepType: raw?.update?.step?.type,
            });

            if (updateType === 'ask-question') {
              const payload_ = raw.update?.payload as
                | {
                  type: 'ask-question';
                  questionId?: string;
                  question: string;
                  inputType?: 'single-select' | 'multi-select' | 'text';
                  options?: Array<{ label: string; description?: string }>;
                  allowFreeform?: boolean;
                }
                | undefined;
              if (!payload_?.question) return;

              const questionId = payload_.questionId ?? `unknown-${Date.now()}`;
              const askPrompt = {
                type: 'ask-question',
                questionId,
                question: payload_.question,
                inputType: payload_.inputType ?? 'text',
                options: payload_.options,
                allowFreeform: payload_.allowFreeform ?? true,
              };

              const content = `<functions_result>
Tool: ask-question
Parameters: {}
Result: ${JSON.stringify(askPrompt)}
</functions_result>`;

              const message = this.createWorkerProjectionMessage({
                conversationId,
                messageId: `worker-ask-${questionId}`,
                turnId: this.workerActiveTurnIdByConversationId.get(conversationId),
                role: 'agent',
                content,
              });
              void this.publishWorkerUpdate(agentId, 'input-required', message).catch(() => undefined);
              return;
            }

            if (updateType === 'tool-approval') {
              const payload_ = raw.update?.payload as
                | {
                  type: 'tool-approval';
                  approvalId: string;
                  toolName: string;
                  parameters: Record<string, unknown>;
                }
                | undefined;
              if (!payload_?.approvalId || !payload_?.toolName) return;

              const approvalPrompt = {
                type: 'tool-approval',
                approvalId: payload_.approvalId,
                toolName: payload_.toolName,
                parameters: payload_.parameters ?? {},
              };

              const content = `<functions_result>
Tool: tool-approval
Parameters: {}
Result: ${JSON.stringify(approvalPrompt)}
</functions_result>`;

              const message = this.createWorkerProjectionMessage({
                conversationId,
                messageId: `worker-approval-${payload_.approvalId}`,
                turnId: this.workerActiveTurnIdByConversationId.get(conversationId),
                role: 'agent',
                content,
              });
              void this.publishWorkerUpdate(agentId, 'input-required', message).catch(() => undefined);
              return;
            }

            if (updateType === 'agent-step') {
              const step = raw.update?.step;
              const stepType = step?.type;
              if (!stepType) return;
              if (stepType === 'message') {
                const data: unknown = step.data;
                const delta = typeof data === 'string'
                  ? data
                  : data &&
                      typeof data === 'object' &&
                      'content' in data &&
                      typeof data.content === 'string'
                  ? data.content
                  : JSON.stringify(data ?? '');
                logger.warn('MemeLoop UtilityProcess assistant delta', {
                  agentId,
                  conversationId,
                  deltaPreview: delta.slice(0, 120),
                });
                if (!lastWasAssistantMessage) {
                  assistantMessageId = `worker-assistant-${Date.now()}`;
                  assistantBuffer = delta;
                } else {
                  assistantBuffer += delta;
                }
                lastWasAssistantMessage = true;
                const messageId = assistantMessageId ?? `worker-assistant-${Date.now()}`;
                const message = this.createWorkerProjectionMessage({
                  conversationId,
                  messageId,
                  turnId: this.workerActiveTurnIdByConversationId.get(conversationId),
                  role: 'assistant',
                  content: assistantBuffer,
                });
                void this.publishWorkerUpdate(agentId, 'working', message).catch(() => undefined);
                return;
              }
              if (stepType === 'thinking') {
                lastWasAssistantMessage = false;
                // Compaction is represented only by Core's durable
                // ContextCompactionBoundaryV2. A transient thinking step must
                // not create a second, ordinary assistant message.
                return;
              }
              if (stepType === 'tool') {
                lastWasAssistantMessage = false;
                const data: unknown = step.data;
                const content = this.extractToolStepText(data);
                logger.warn('MemeLoop tool step materialized', {
                  agentId,
                  conversationId,
                  contentPreview: content.slice(0, 200),
                });
                const message = this.createWorkerProjectionMessage({
                  conversationId,
                  messageId: `worker-tool-${Date.now()}`,
                  turnId: this.workerActiveTurnIdByConversationId.get(conversationId),
                  role: 'tool',
                  content,
                });
                void this.publishWorkerUpdate(agentId, 'working', message).catch(() => undefined);
              }
              return;
            }
            if (updateType === 'cancelled') {
              const finalMessageId = assistantMessageId;
              const finalContent = assistantBuffer;
              lastWasAssistantMessage = false;
              assistantMessageId = undefined;
              assistantBuffer = '';
              let finalMessage: AgentInstanceMessage | undefined;
              if (finalMessageId) {
                finalMessage = this.createWorkerProjectionMessage({
                  conversationId,
                  messageId: finalMessageId,
                  turnId: this.workerActiveTurnIdByConversationId.get(conversationId),
                  role: 'assistant',
                  content: finalContent,
                });
              }
              void this.publishWorkerUpdate(agentId, 'canceled', finalMessage).catch(() => undefined);
              this.workerActiveTurnIdByConversationId.delete(conversationId);
              this.workerActiveRunIdByConversationId.delete(conversationId);
              return;
            }
            if (updateType === 'agent-done') {
              const finalMessageId = assistantMessageId;
              const finalContent = assistantBuffer;
              lastWasAssistantMessage = false;
              assistantMessageId = undefined;
              assistantBuffer = '';
              let finalMessage: AgentInstanceMessage | undefined;
              if (finalMessageId) {
                finalMessage = this.createWorkerProjectionMessage({
                  conversationId,
                  messageId: finalMessageId,
                  turnId: this.workerActiveTurnIdByConversationId.get(conversationId),
                  role: 'assistant',
                  content: finalContent,
                });
              }
              void this.publishWorkerUpdate(agentId, 'completed', finalMessage).catch(() => undefined);
              this.workerActiveTurnIdByConversationId.delete(conversationId);
              this.workerActiveRunIdByConversationId.delete(conversationId);
              return;
            }
            if (updateType === 'agent-error') {
              lastWasAssistantMessage = false;
              const message = this.createWorkerProjectionMessage({
                conversationId,
                messageId: `worker-error-${Date.now()}`,
                turnId: this.workerActiveTurnIdByConversationId.get(conversationId),
                role: 'error',
                content: raw?.update?.error || 'MemeLoop UtilityProcess error',
              });
              void this.publishWorkerUpdate(agentId, 'failed', message).catch(() => undefined);
              this.workerActiveTurnIdByConversationId.delete(conversationId);
              this.workerActiveRunIdByConversationId.delete(conversationId);
            }
          },
          error: (error: unknown) => {
            logger.warn('MemeLoop UtilityProcess update stream failed', {
              agentId,
              conversationId,
              error,
            });
          },
        });
      this.workerConversationCleanupByAgentId.set(agentId, () => {
        subscription.unsubscribe();
      });
    } catch (error) {
      logger.warn('Failed to bind MemeLoop UtilityProcess update stream', {
        agentId,
        conversationId,
        error,
      });
    }
  }

  /**
   * Publish a bounded live projection without writing synthetic stream chunks
   * into the legacy TypeORM message table. The UtilityProcess SQLite event log
   * is the only durable conversation store; this message exists only long
   * enough for the renderer to show current progress.
   */
  private async publishWorkerUpdate(
    agentId: string,
    state: AgentInstanceLatestStatus['state'],
    message?: AgentInstanceMessage,
  ): Promise<void> {
    this.ensureRepositories();
    await repo.updateAgent(
      this.agentInstanceRepository!,
      this.agentMessageRepository!,
      this.agentDefinitionService,
      agentId,
      { status: { state, modified: new Date() } },
    );
    const metadata = await this.getAgentMetadata(agentId);
    if (metadata) this.notifyAgentUpdate(agentId, metadata, message);
  }

  private cleanupWorkerConversation(agentId: string): void {
    const workerConversationId = this.workerConversationByAgentId.get(agentId);
    const cleanup = this.workerConversationCleanupByAgentId.get(agentId);
    if (cleanup) {
      try {
        cleanup();
      } catch {
        logger.warn('MemeLoop UtilityProcess conversation cleanup failed during agent removal');
      }
      this.workerConversationCleanupByAgentId.delete(agentId);
    }
    if (workerConversationId) {
      this.workerAgentIdByConversationId.delete(workerConversationId);
      this.workerActiveTurnIdByConversationId.delete(workerConversationId);
      this.workerActiveRunIdByConversationId.delete(workerConversationId);
    }
  }

  private async cancelWorkerConversation(agentId: string): Promise<void> {
    const workerConversationId = this.workerConversationByAgentId.get(agentId);
    if (!workerConversationId) return;
    try {
      await this.ensureMemeLoopWorkerHealthy();
    } catch (error: unknown) {
      logger.debug('MemeLoop UtilityProcess conversation was unavailable during cancellation', { error });
      return;
    }
    if (!this.memeLoopWorker) return;
    try {
      await this.memeLoopWorker.cancelRun(
        workerConversationId,
        this.workerActiveRunIdByConversationId.get(workerConversationId),
      );
    } catch (error) {
      logger.warn(
        'Failed to cancel MemeLoop UtilityProcess conversation during cleanup',
        { agentId, workerConversationId, error },
      );
    }
  }

  public async resolveToolApproval(
    approvalId: string,
    decision: 'allow' | 'deny',
  ): Promise<void> {
    await this.ensureMemeLoopWorkerHealthy();
    if (!this.memeLoopWorker) throw new Error('MemeLoop runtime is unavailable');
    await this.memeLoopWorker.resolveToolApproval(approvalId, decision);
  }

  public resolveAskQuestion(
    agentId: string,
    questionId: string,
    answer: string,
  ): void {
    // Prefer resolving inside the MemeLoop UtilityProcess so the agent can continue in the same turn.
    void (async () => {
      try {
        await this.ensureMemeLoopWorkerHealthy();
      } catch (error) {
        logger.warn('MemeLoop UtilityProcess unavailable for resolveAskQuestion', { agentId, error });
        return;
      }
      if (this.memeLoopWorker) {
        try {
          const result = await this.memeLoopWorker.resolveAskQuestion(
            agentId,
            questionId,
            answer,
          );
          if (result?.resolved) return;
        } catch (error) {
          logger.warn('MemeLoop UtilityProcess resolveAskQuestion failed', { agentId, questionId, error });
        }
      }
    })();
  }

  public async setBackgroundHeartbeat(
    agentId: string,
    heartbeat: SetBackgroundHeartbeatInput,
  ): Promise<void> {
    this.ensureRepositories();

    const entity = await this.agentInstanceRepository!.findOne({
      where: { id: agentId },
    });
    if (!entity) {
      throw new Error(`Agent instance not found: ${agentId}`);
    }
    if (!entity.agentDefId) {
      throw new Error(`Agent definition not found for instance: ${agentId}`);
    }

    const agentDefinition = await this.agentDefinitionService.getAgentDef(
      entity.agentDefId,
    );
    if (!agentDefinition) {
      throw new Error(`Agent definition not found: ${entity.agentDefId}`);
    }

    const normalizedHeartbeat: AgentHeartbeatConfig = {
      enabled: heartbeat.enabled,
      intervalSeconds: Math.max(
        60,
        Math.round(heartbeat.intervalSeconds || 60),
      ),
      message: heartbeat.message?.trim() ||
        '[Heartbeat] Periodic check-in. Review your tasks and take any pending actions.',
      activeHoursStart: heartbeat.activeHoursStart || undefined,
      activeHoursEnd: heartbeat.activeHoursEnd || undefined,
    };

    await this.agentDefinitionService.updateAgentDef({
      id: agentDefinition.id,
      heartbeat: normalizedHeartbeat,
    });

    if (normalizedHeartbeat.enabled && !entity.volatile) {
      startHeartbeat(agentId, normalizedHeartbeat, this, {
        createdBy: 'settings-ui',
      });
    } else {
      stopHeartbeat(agentId);
    }

    logger.info('Background heartbeat upserted from UI', {
      agentId,
      enabled: normalizedHeartbeat.enabled,
      intervalSeconds: normalizedHeartbeat.intervalSeconds,
      activeHoursStart: normalizedHeartbeat.activeHoursStart,
      activeHoursEnd: normalizedHeartbeat.activeHoursEnd,
    });
  }

  // ── ScheduledTask CRUD ────────────────────────────────────────────────────

  public async createScheduledTask(
    input: CreateScheduledTaskInput,
    options?: ScheduledTaskCallOptions,
  ): Promise<ScheduledTask> {
    return stmAddTask(input, options);
  }

  public async updateScheduledTask(
    input: UpdateScheduledTaskInput,
  ): Promise<ScheduledTask> {
    return stmUpdateTask(input);
  }

  public async updateScheduledTaskScoped(
    scope: ScheduledTaskScope,
    input: UpdateScheduledTaskInput,
    options?: ScheduledTaskCallOptions,
  ): Promise<ScheduledTask> {
    return stmUpdateTaskScoped(scope, input, options);
  }

  public async deleteScheduledTask(taskId: string): Promise<void> {
    return stmRemoveTask(taskId);
  }

  public async deleteScheduledTaskScoped(scope: ScheduledTaskScope, options?: ScheduledTaskCallOptions): Promise<void> {
    return stmRemoveTaskScoped(scope, options);
  }

  public async getScheduledTaskByScope(scope: ScheduledTaskScope, options?: ScheduledTaskCallOptions): Promise<ScheduledTask | undefined> {
    return stmGetTaskByScope(scope, options);
  }

  public async listScheduledTasks(options?: ListScheduledTasksOptions): Promise<ScheduledTask[]> {
    return stmGetActiveTasks(options);
  }

  public async listScheduledTasksForAgent(
    agentInstanceId: string,
    options?: ListScheduledTasksOptions,
  ): Promise<ScheduledTask[]> {
    return stmGetActiveTasksForAgent(agentInstanceId, options);
  }

  public async listScheduledTasksPageForAgent(input: ListScheduledTasksPageForAgentInput): Promise<ScheduledTaskStoragePage> {
    return stmGetScheduledTasksPageForAgent(input);
  }

  public async listRemoteScheduledTaskProjectionPageForAgent(
    input: ListRemoteScheduledTaskProjectionPageInput,
  ): Promise<RemoteScheduledTaskProjectionPage> {
    this.ensureRepositories();
    if (!this.remoteScheduledTaskProjectionRepository) throw new Error('scheduled_task_projection_repository_unavailable');
    return getRemoteScheduledTaskProjectionPage(this.remoteScheduledTaskProjectionRepository, input);
  }

  public async replaceRemoteScheduledTaskProjections(
    agentInstanceId: string,
    executionNodeId: string,
    tasks: ScheduledTask[],
    observedAt: number,
  ): Promise<void> {
    this.ensureRepositories();
    if (!this.remoteScheduledTaskProjectionRepository) throw new Error('scheduled_task_projection_repository_unavailable');
    await replaceRemoteProjections(this.remoteScheduledTaskProjectionRepository, agentInstanceId, executionNodeId, tasks, observedAt);
  }

  public async upsertRemoteScheduledTaskProjection(task: ScheduledTask, observedAt: number): Promise<void> {
    this.ensureRepositories();
    if (!this.remoteScheduledTaskProjectionRepository) throw new Error('scheduled_task_projection_repository_unavailable');
    await upsertRemoteProjection(this.remoteScheduledTaskProjectionRepository, task, observedAt);
  }

  public async deleteRemoteScheduledTaskProjection(taskId: string, executionNodeId: string): Promise<void> {
    this.ensureRepositories();
    if (!this.remoteScheduledTaskProjectionRepository) throw new Error('scheduled_task_projection_repository_unavailable');
    await deleteRemoteProjection(this.remoteScheduledTaskProjectionRepository, taskId, executionNodeId);
  }

  public async getCronPreviewDates(
    expression: string,
    timezone?: string,
    count = 3,
  ): Promise<string[]> {
    return stmGetCronPreviewDates(expression, timezone, count);
  }

  public subscribeToAgentUpdates(
    agentId: string,
  ): Observable<AgentInstanceUpdate | undefined> {
    // If no messageId is provided, publish metadata/run state plus at most one
    // incremental message. History always travels through bounded paging.
    if (!this.agentInstanceSubjects.has(agentId)) {
      this.agentInstanceSubjects.set(
        agentId,
        new BehaviorSubject<AgentInstanceUpdate | undefined>(undefined),
      );

      // Initial subscription state is metadata-only. Chat views explicitly
      // request their bounded resident window and therefore cannot accidentally
      // structured-clone a 100k-message conversation here.
      this.getAgentMetadata(agentId)
        .then((agent) => {
          if (!agent) {
            this.agentInstanceSubjects.get(agentId)?.next(undefined);
            return;
          }
          this.agentInstanceSubjects.get(agentId)?.next(this.createAgentInstanceUpdate(agent));
        })
        .catch((error: unknown) => {
          logger.error('Failed to get initial agent data', {
            function: 'subscribeToAgentUpdates',
            error,
          });
        });
    }

    return this.agentInstanceSubjects.get(agentId)!.asObservable();
  }

  /**
   * Notify agent subscription of updates
   * @param agentId Agent ID
   * @param agentData Agent data to use for notification
   */
  private createAgentInstanceUpdate(
    agentData: AgentInstanceMetadata,
    message?: AgentInstanceMessage,
  ): AgentInstanceUpdate {
    return { agent: agentData, ...(message ? { message } : {}) };
  }

  private notifyAgentUpdate(
    agentId: string,
    agentData: AgentInstanceMetadata,
    message?: AgentInstanceMessage,
  ): void {
    try {
      // Only notify if there are active subscriptions
      if (this.agentInstanceSubjects.has(agentId)) {
        this.agentInstanceSubjects.get(agentId)?.next(
          this.createAgentInstanceUpdate(agentData, message),
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to notify agent update: ${errorMessage}`);
    }
  }

  /**
   * Stop the MemeLoop UtilityProcess once and drop its protocol proxy. Call
   * from app `before-quit` so the child can close its server and SQLite store
   * before the OS process is terminated.
   */
  public async disposeMemeLoopWorker(): Promise<void> {
    if (this.memeLoopDisposePromise) return this.memeLoopDisposePromise;
    this.memeLoopDisposePromise = (async () => {
      this.memeLoopStartupAbortController?.abort(new Error('MemeLoop UtilityProcess shutdown requested'));
      this.memeLoopStartupAbortController = undefined;
      this.abortUtilityProcessHostCallbacks(new Error('MemeLoop UtilityProcess shutdown requested'));
      this.memeLoopWorkerLogCleanup?.();
      this.memeLoopWorkerLogCleanup = undefined;
      for (const subscription of this.workerConversationMutationSubscriptions) {
        subscription.unsubscribe();
      }
      this.workerConversationMutationSubscriptions.clear();
      this.agentToolRuntime?.dispose();
      this.agentToolRuntime = undefined;
      this.frameworkSchemas.clear();
      for (
        const [agentId, cleanup] of [
          ...this.workerConversationCleanupByAgentId.entries(),
        ]
      ) {
        try {
          cleanup();
        } catch {
          logger.warn('MemeLoop UtilityProcess conversation cleanup failed during dispose');
        }
        this.workerConversationCleanupByAgentId.delete(agentId);
      }
      this.workerAgentIdByConversationId.clear();
      this.workerConversationByAgentId.clear();

      const proxy = this.memeLoopWorker;
      const utilityProcess = this.memeLoopUtilityProcess;
      if (proxy) {
        try {
          await proxy.shutdown();
        } catch (error) {
          logger.warn('Failed to gracefully shut down MemeLoop UtilityProcess', {
            error,
          });
        }
      }
      if (utilityProcess) {
        try {
          utilityProcess.kill();
        } catch (error) {
          logger.warn('Failed to terminate MemeLoop UtilityProcess', { error });
        }
      }
      this.memeLoopUtilityProcess = undefined;
      this.memeLoopWorker = undefined;
      this.memeLoopOrchestrationEndpoint = undefined;
    })();
    try {
      await this.memeLoopDisposePromise;
    } finally {
      this.memeLoopDisposePromise = undefined;
    }
  }

  private requireAgentToolRuntime(): AppAgentToolRuntime {
    if (!this.agentToolRuntime) {
      throw new Error('MemeLoop App agent tool runtime is not initialized');
    }
    return this.agentToolRuntime;
  }

  public getFrameworkConfigSchema(
    frameworkId: string,
  ): Record<string, unknown> {
    try {
      logger.debug('AgentInstanceService.getFrameworkConfigSchema called', {
        frameworkId,
      });
      // Check if we have a schema for this framework
      const schema = this.frameworkSchemas.get(frameworkId);
      if (schema) {
        return schema;
      }
      // If no schema found, return an empty schema
      logger.warn(`No schema found for framework: ${frameworkId}`);
      return { type: 'object', properties: {} };
    } catch (error) {
      logger.error('Error in AgentInstanceService.getFrameworkConfigSchema', {
        error,
        frameworkId,
      });
      throw error;
    }
  }
}
