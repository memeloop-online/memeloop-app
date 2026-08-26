import 'source-map-support/register';

import type { ModelMessage } from 'ai';
import { nanoid } from 'nanoid';
import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { parentPort } from 'node:worker_threads';
import { Observable, Subject } from 'rxjs';

import { handleWorkerMessages } from '@services/libs/workerAdapter';

import {
  type AgentDefinition,
  type AgentRuntimeRpcStorage,
  type ChatMessage,
  createAgentRuntimeDeviceRpcHandler,
  type DeviceCapabilities,
  type DeviceRpcHandler,
  type DeviceRpcHandlerInput,
  prepareAgentExecutionModelRequest,
  type PromptPreviewAuditDetailRequest,
  type PromptPreviewAuditPageRequest,
  type PromptPreviewAuditReleaseRequest,
  PromptPreviewAuditSessionStore,
} from 'memeloop';
import type { NodeRuntimeResult } from 'memeloop-cli/runtime';
import { requireDesktopAtomicRetryStore } from './atomicRetryCapability';
import { type ConversationMutationWake, installConversationMutationObserver } from './conversationMutationObserver';
import type { IAgentInstanceService } from './interface';
import { createDesktopRetryTurnHandler } from './retryTurn';
import { createDesktopScheduledTaskRpcHandler } from './scheduledTaskRpcStore';
import type {
  CreateScheduledTaskInput,
  ListRemoteScheduledTaskProjectionPageInput,
  ListScheduledTasksPageForAgentInput,
  ScheduledTask,
  ScheduledTaskCallOptions,
  ScheduledTaskScope,
  UpdateScheduledTaskInput,
} from './scheduledTaskTypes';
import { createDesktopAgentRuntimeProjectionStore } from './sqliteAgentRuntimeProjectionStore';
import { TerminalSessionManager } from './terminal/sessionManager';
import { ensureMemeLoopWorkerDataDirectory } from './workerDataDirectory';

type WorkerLogEvent = {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  meta?: unknown;
};

// Use the existing workerAdapter Observable streaming channel for logs,
// so we don't invent a one-off postMessage protocol.
const logSubject = new Subject<WorkerLogEvent>();
const conversationMutationSubject = new Subject<ConversationMutationWake>();
function workerLog(
  level: WorkerLogEvent['level'],
  message: string,
  meta?: unknown,
): void {
  try {
    logSubject.next({ level, message, meta });
  } catch {
    // ignore
  }
}

type MainLlmChatRequest = {
  conversationId?: string;
  messages: ModelMessage[];
};

type PendingLlmStream = {
  deltas: string[];
  waiters: Array<(r: IteratorResult<string, undefined>) => void>;
  done: boolean;
  error?: Error;
};
const pendingMainLlmChat = new Map<string, PendingLlmStream>();
type PendingMainRequest<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};
const pendingMainToolList = new Map<string, PendingMainRequest<string[]>>();
const pendingMainToolCall = new Map<string, PendingMainRequest<unknown>>();
const pendingMainScheduledTaskCall = new Map<string, PendingMainRequest<unknown>>();

if (parentPort) {
  parentPort.on('message', (message: unknown) => {
    const m = message as {
      type?: string;
      id?: string;
      delta?: string;
      tools?: string[];
      result?: unknown;
      error?: { message: string; name?: string; stack?: string };
    };
    if (!m?.id) return;
    if (m.type === 'memeloop-tool-list-result') {
      const pending = pendingMainToolList.get(m.id);
      if (!pending) return;
      pendingMainToolList.delete(m.id);
      pending.resolve(
        Array.isArray(m.tools)
          ? m.tools.filter((t): t is string => typeof t === 'string')
          : [],
      );
      return;
    }
    if (m.type === 'memeloop-tool-call-result') {
      const pending = pendingMainToolCall.get(m.id);
      if (!pending) return;
      pendingMainToolCall.delete(m.id);
      pending.resolve(m.result);
      return;
    }
    if (m.type === 'memeloop-tool-call-error') {
      const pending = pendingMainToolCall.get(m.id);
      if (!pending) return;
      pendingMainToolCall.delete(m.id);
      const error = new Error(m.error?.message ?? 'memeloop-tool-call failed');
      error.name = m.error?.name ?? 'Error';
      error.stack = m.error?.stack;
      pending.reject(error);
      return;
    }
    if (m.type === 'memeloop-scheduled-task-call-result') {
      const pending = pendingMainScheduledTaskCall.get(m.id);
      if (!pending) return;
      pendingMainScheduledTaskCall.delete(m.id);
      pending.resolve(m.result);
      return;
    }
    if (m.type === 'memeloop-scheduled-task-call-error') {
      const pending = pendingMainScheduledTaskCall.get(m.id);
      if (!pending) return;
      pendingMainScheduledTaskCall.delete(m.id);
      const error = new Error(m.error?.message ?? 'memeloop-scheduled-task-call failed');
      error.name = m.error?.name ?? 'Error';
      error.stack = m.error?.stack;
      pending.reject(error);
      return;
    }

    const pending = pendingMainLlmChat.get(m.id);
    if (!pending) return;
    if (m.type === 'memeloop-llm-chat-delta') {
      const delta = m.delta ?? '';
      if (!delta) return;
      const waiter = pending.waiters.shift();
      if (waiter) waiter({ value: delta, done: false });
      else pending.deltas.push(delta);
    } else if (m.type === 'memeloop-llm-chat-done') {
      pending.done = true;
      while (pending.waiters.length > 0) {
        const waiter = pending.waiters.shift();
        if (waiter) waiter({ value: undefined, done: true });
      }
      pendingMainLlmChat.delete(m.id);
    } else if (m.type === 'memeloop-llm-chat-error') {
      const error = new Error(m.error?.message ?? 'memeloop-llm-chat failed');
      error.name = m.error?.name ?? 'Error';
      error.stack = m.error?.stack;
      pending.error = error;
      while (pending.waiters.length > 0) {
        const waiter = pending.waiters.shift();
        if (waiter) waiter({ value: undefined, done: true });
      }
      pendingMainLlmChat.delete(m.id);
    }
  });
}

function makeMainRequestId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function requestMainBridgeToolList(timeoutMs = 10000): Promise<string[]> {
  const id = makeMainRequestId('tools');
  const result = await new Promise<string[]>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingMainToolList.delete(id);
      reject(new Error(`memeloop-tool-list timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pendingMainToolList.set(id, {
      resolve: (tools) => {
        clearTimeout(timeout);
        resolve(tools);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    parentPort?.postMessage({ type: 'memeloop-tool-list', id });
  });
  return result;
}

async function callMainTool(
  toolId: string,
  arguments_: Record<string, unknown>,
  timeoutMs = 60000,
): Promise<unknown> {
  const id = makeMainRequestId('toolcall');
  const result = await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingMainToolCall.delete(id);
      reject(
        new Error(
          `memeloop-tool-call timed out after ${timeoutMs}ms for ${toolId}`,
        ),
      );
    }, timeoutMs);
    pendingMainToolCall.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    parentPort?.postMessage({ type: 'memeloop-tool-call', id, toolId, args: arguments_ });
  });
  return result;
}

async function callMainScheduledTask<T>(
  method: string,
  arguments_: unknown[],
  signal?: AbortSignal,
  timeoutMs = 30_000,
): Promise<T> {
  signal?.throwIfAborted();
  const id = makeMainRequestId('scheduled-task');
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      pendingMainScheduledTaskCall.delete(id);
    };
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = (): void => {
      parentPort?.postMessage({ type: 'memeloop-scheduled-task-cancel', id });
      finish(() => {
        reject(signal?.reason instanceof Error ? signal.reason : new Error('scheduled_task_call_aborted'));
      });
    };
    const timeout = setTimeout(() => {
      parentPort?.postMessage({ type: 'memeloop-scheduled-task-cancel', id });
      finish(() => {
        reject(new Error(`memeloop-scheduled-task-call timed out after ${timeoutMs}ms for ${method}`));
      });
    }, timeoutMs);
    pendingMainScheduledTaskCall.set(id, {
      resolve: value => {
        finish(() => {
          resolve(value as T);
        });
      },
      reject: error => {
        finish(() => {
          reject(error);
        });
      },
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else parentPort?.postMessage({ type: 'memeloop-scheduled-task-call', id, method, arguments: arguments_ });
  });
}

function createMainScheduledTaskServiceBridge(): IAgentInstanceService {
  const bridge = {
    createScheduledTask: (input: CreateScheduledTaskInput, options?: ScheduledTaskCallOptions) =>
      callMainScheduledTask<ScheduledTask>('createScheduledTask', [input], options?.signal),
    updateScheduledTaskScoped: (scope: ScheduledTaskScope, input: UpdateScheduledTaskInput, options?: ScheduledTaskCallOptions) =>
      callMainScheduledTask<ScheduledTask>('updateScheduledTaskScoped', [scope, input], options?.signal),
    deleteScheduledTaskScoped: async (scope: ScheduledTaskScope, options?: ScheduledTaskCallOptions) => {
      await callMainScheduledTask<undefined>('deleteScheduledTaskScoped', [scope], options?.signal);
    },
    getScheduledTaskByScope: (scope: ScheduledTaskScope, options?: ScheduledTaskCallOptions) =>
      callMainScheduledTask<ScheduledTask | undefined>('getScheduledTaskByScope', [scope], options?.signal),
    listScheduledTasksPageForAgent: (input: ListScheduledTasksPageForAgentInput) => {
      const { signal, ...cloneableInput } = input;
      return callMainScheduledTask('listScheduledTasksPageForAgent', [cloneableInput], signal);
    },
    listRemoteScheduledTaskProjectionPageForAgent: (input: ListRemoteScheduledTaskProjectionPageInput) =>
      callMainScheduledTask('listRemoteScheduledTaskProjectionPageForAgent', [input]),
    getCronPreviewDates: (expression: string, timezone?: string, count?: number) => callMainScheduledTask<string[]>('getCronPreviewDates', [expression, timezone, count]),
  } satisfies Partial<IAgentInstanceService>;
  return bridge as unknown as IAgentInstanceService;
}

async function* callMainLlmChat(
  request: MainLlmChatRequest,
): AsyncGenerator<string, void, unknown> {
  const id = `llm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const pending: PendingLlmStream = { deltas: [], waiters: [], done: false };
  pendingMainLlmChat.set(id, pending);
  parentPort?.postMessage({ type: 'memeloop-llm-chat', id, request });

  while (true) {
    const streamError = readPendingLlmError(pending);
    if (streamError) throw streamError;
    if (pending.deltas.length > 0) {
      yield pending.deltas.shift()!;
      continue;
    }
    if (pending.done) return;
    const next = await new Promise<IteratorResult<string, undefined>>(
      (resolve) => {
        pending.waiters.push(resolve);
      },
    );
    const resumedError = readPendingLlmError(pending);
    if (resumedError) throw resumedError;
    if (next.done) return;
    if (next.value) yield next.value;
  }
}

function readPendingLlmError(pending: PendingLlmStream): Error | undefined {
  return pending.error;
}

const workerLogger = {
  warn: (...a: unknown[]) => {
    workerLog('warn', '[memeloop-worker]', { a });
  },
  error: (...a: unknown[]) => {
    workerLog('error', '[memeloop-worker]', { a });
  },
};

process.on('uncaughtException', (error) => {
  workerLog('error', '[memeloop-worker] uncaughtException', { err: error });
});
process.on('unhandledRejection', (reason) => {
  workerLog('error', '[memeloop-worker] unhandledRejection', { reason });
});
process.on('exit', (code) => {
  workerLog('error', '[memeloop-worker] exit', { code });
});
for (
  const sig of [
    'SIGABRT',
    'SIGSEGV',
    'SIGILL',
    'SIGFPE',
    'SIGBUS',
    'SIGTERM',
    'SIGHUP',
    'SIGINT',
  ] as const
) {
  process.on(sig, () => {
    workerLog('error', '[memeloop-worker] signal', { sig });
  });
}

type RuntimeUpdate = { conversationId: string; update: unknown };

type AskQuestionPrompt = {
  type: 'ask-question';
  questionId?: string;
  question: string;
  inputType?: 'single-select' | 'multi-select' | 'text';
  options?: Array<{ label: string; description?: string }>;
  allowFreeform?: boolean;
};

type ToolApprovalPrompt = {
  type: 'tool-approval';
  approvalId: string;
  toolName: string;
  parameters: Record<string, unknown>;
};

type WorkerCustomUpdate =
  | { type: 'ask-question'; payload: AskQuestionPrompt }
  | { type: 'tool-approval'; payload: ToolApprovalPrompt };

const customUpdateListenersByConversationId = new Map<
  string,
  Set<(update: WorkerCustomUpdate) => void>
>();
function emitCustomUpdate(
  conversationId: string | undefined,
  update: WorkerCustomUpdate,
): void {
  // Some runtimes may pass a different identifier than the one we used for subscribeToUpdates().
  // When we can't match a set by id, broadcast to all listener sets to avoid missing ask-question/tool-approval.
  const setById = conversationId
    ? customUpdateListenersByConversationId.get(conversationId)
    : undefined;
  const targetSets = setById && setById.size > 0
    ? [setById]
    : Array.from(customUpdateListenersByConversationId.values());
  if (targetSets.length === 0) return;

  workerLog('warn', '[memeloop-worker] emitCustomUpdate', {
    conversationId,
    type: update.type,
    targetSets: targetSets.length,
    questionId: update.type === 'ask-question' ? update.payload.questionId : undefined,
    question: update.type === 'ask-question' ? update.payload.question : undefined,
    inputType: update.type === 'ask-question' ? update.payload.inputType : undefined,
  });

  // Deduplicate listeners across sets.
  const listeners = new Set<(update: WorkerCustomUpdate) => void>();
  for (const s of targetSets) {
    for (const l of s) listeners.add(l);
  }

  for (const listener of listeners) {
    try {
      listener(update);
    } catch {
      // ignore listener errors
    }
  }
}

const conversationCancellation = new Set<string>();

const llmProvider = {
  name: 'tidgi-memeloop-worker',
  model: undefined,
  chat: async function*(request: unknown) {
    const request_ = request as {
      messages?: ModelMessage[];
      conversationId?: string;
    };
    for await (
      const delta of callMainLlmChat({
        conversationId: request_.conversationId,
        messages: request_.messages ?? [],
      })
    ) {
      yield { type: 'text-delta' as const, text: delta, id: nanoid() };
    }
  },
};

let localNodeId = `tidgi-desktop-${nanoid(8)}`;
const terminalManager = new TerminalSessionManager();

let runtime: NodeRuntimeResult['runtime'] | undefined;
let storage: NodeRuntimeResult['storage'] | undefined;
let runtimeContext: NodeRuntimeResult['context'] | undefined;
let approvalRequestCleanup: (() => void) | undefined;
let deviceRpcHandler: DeviceRpcHandler | undefined;
let scheduledTaskRpcHandler: ReturnType<typeof createDesktopScheduledTaskRpcHandler> | undefined;
let runtimeToolIds: string[] = [];
let runtimeAgentDefinitions: AgentDefinition[] = [];
let orchestrationClient:
  | import('memeloop').AgentOrchestrationClient
  | undefined;
let stopNodeRuntime: (() => Promise<void>) | undefined;
let createRemoteOrchestrationHttpHandlerFunction:
  | typeof import('memeloop-cli/runtime').createRemoteOrchestrationHttpHandler
  | undefined;
let runtimeInitPromise: Promise<void> | undefined;
let conversationMutationObserverCleanup: (() => void) | undefined;
const promptPreviewAuditStore = new PromptPreviewAuditSessionStore({
  createSessionId: () => `desktop-preview-${nanoid()}`,
  createRevision: () => `preview-revision-${nanoid()}`,
});
const promptPreviewPrepareOperations = new Map<string, AbortController>();

interface DesktopHostConfig {
  dataDir: string;
  sqliteNativeBinding: string;
  orchestrationAccessToken: string;
  localPeerId: string;
  orchestrationHost?: string;
}

let hostConfig: DesktopHostConfig | undefined;

function requireHostConfig(): DesktopHostConfig {
  if (!hostConfig) {
    throw new Error('MemeLoop worker host configuration is required before initialization');
  }
  return hostConfig;
}

function authorized(request: http.IncomingMessage, accessToken: string): boolean {
  const actual = Buffer.from(request.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${accessToken}`);
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

async function ensureRuntimeInitialized(): Promise<void> {
  if (runtime) return;
  if (runtimeInitPromise) {
    await runtimeInitPromise;
    return;
  }

  runtimeInitPromise = (async () => {
    // Load focused entries so Desktop does not pull CLI/TUI/libp2p dependencies
    // into the worker when it only needs the orchestration runtime and identity.
    const memeloopRuntime = await import('memeloop-cli/runtime');
    const {
      createNodeRuntime,
      ToolRegistry,
      createRemoteOrchestrationHttpHandler,
    } = memeloopRuntime;
    createRemoteOrchestrationHttpHandlerFunction = createRemoteOrchestrationHttpHandler;
    const configuredHost = requireHostConfig();
    localNodeId = configuredHost.localPeerId;

    const mainBridgeToolIds = await requestMainBridgeToolList().catch(
      (error: unknown) => {
        workerLog(
          'warn',
          '[memeloop-worker] failed to load main bridge tool list',
          { error },
        );
        return [] as string[];
      },
    );

    const runtimeResult = await createNodeRuntime({
      // Core supplies the official profiles. App-specific definitions are
      // resolved explicitly from storage and must never shadow Core defaults.
      config: { agents: [] },
      dataDir: configuredHost.dataDir,
      sqliteNativeBinding: configuredHost.sqliteNativeBinding,
      localNodeId,
      llmProvider,
      toolRegistry: new ToolRegistry(),
      configureTools(registry) {
        for (const toolId of mainBridgeToolIds) {
          if (
            typeof registry.getTool === 'function' &&
            registry.getTool(toolId)
          ) {
            continue;
          }
          registry.registerTool(
            toolId,
            async (arguments_: Record<string, unknown>) => {
              return callMainTool(toolId, arguments_ ?? {});
            },
          );
        }
      },
      builtinToolContext: {
        getPeers: async () => [],
        sendRpcToNode: async (
          _nodeId: string,
          _method: string,
          _parameters: unknown,
        ) => {
          throw new Error(
            'Legacy peer RPC is unavailable; use the authenticated resource client.',
          );
        },
        mcpCallRemote: async (
          _nodeId: string,
          _serverName: string,
          _toolName: string,
          _arguments: Record<string, unknown>,
        ) => {
          throw new Error(
            'Legacy peer MCP RPC is unavailable; use a scheduled ToolOperation.',
          );
        },
        notifyAskQuestion: (payload: unknown) => {
          const p = payload as Partial<AskQuestionPrompt> & {
            conversationId?: string;
            questionId?: string;
            question?: string;
          };
          if (!p.questionId || !p.question) return;

          emitCustomUpdate(p.conversationId, {
            type: 'ask-question',
            payload: {
              type: 'ask-question',
              questionId: p.questionId,
              question: p.question,
              inputType: p.inputType ?? undefined,
              options: p.options,
              allowFreeform: p.allowFreeform,
            },
          });
        },
      },
      terminalManager,
      fileBaseDir: process.cwd(),
      includeVscodeCli: false,
      conversationCancellation,
      logger: {
        warn: (...a: unknown[]) => {
          workerLogger.warn(...a);
        },
        error: (...a: unknown[]) => {
          workerLogger.error(...a);
        },
      },
      network: {
        start: async () => undefined,
        stop: async () => undefined,
      },
    });

    await requireDesktopAtomicRetryStore(runtimeResult);

    stopNodeRuntime = () => runtimeResult.stop();
    runtime = runtimeResult.runtime;
    storage = runtimeResult.storage;
    conversationMutationObserverCleanup?.();
    conversationMutationObserverCleanup = installConversationMutationObserver(
      storage,
      wake => {
        conversationMutationSubject.next(wake);
      },
    );
    runtimeContext = runtimeResult.context;
    approvalRequestCleanup?.();
    approvalRequestCleanup = runtimeContext.toolApprovals?.onApprovalRequest(request => {
      emitCustomUpdate(request.conversationId, {
        type: 'tool-approval',
        payload: {
          type: 'tool-approval',
          approvalId: request.approvalId,
          toolName: request.toolName,
          parameters: request.parameters,
        },
      });
    });
    runtimeToolIds = runtimeResult.toolRegistry.listTools();
    runtimeAgentDefinitions = [...runtimeResult.agentDefinitions];
    orchestrationClient = runtimeResult.context.orchestration;
  })();

  await runtimeInitPromise;
}

let desktopNodeServer: http.Server | undefined;
let desktopNodePort: number | undefined;
let desktopNodeStarted = false;
let desktopNodeStartPromise: Promise<void> | undefined;

async function ensureDesktopNodeStarted(requestedPort?: number): Promise<void> {
  await ensureRuntimeInitialized();
  if (desktopNodeStarted) return;
  if (desktopNodeStartPromise) {
    await desktopNodeStartPromise;
    return;
  }

  desktopNodeStartPromise = (async () => {
    let stage = 'init';
    try {
      const environmentPort = parseInt(process.env.TIDGI_MEMELOOP_PORT ?? '', 10);
      const configuredHost = requireHostConfig();
      stage = 'resolve-port';
      const port = typeof requestedPort === 'number' && Number.isFinite(requestedPort) && requestedPort > 0
        ? requestedPort
        : Number.isFinite(environmentPort) && environmentPort > 0
        ? environmentPort
        : 0;
      const listenHost = configuredHost.orchestrationHost ?? '127.0.0.1';
      workerLog(
        'warn',
        '[memeloop-worker][desktop-as-node] ensureDesktopNodeStarted',
        {
          stage,
          port,
          nodeId: localNodeId,
          env: { NODE_ENV: process.env.NODE_ENV },
        },
      );
      stage = 'create-server';
      if (!createRemoteOrchestrationHttpHandlerFunction || !orchestrationClient) {
        throw new Error('Node runtime did not provide an orchestration client');
      }
      const orchestrationHandler = createRemoteOrchestrationHttpHandlerFunction(orchestrationClient, {
        authorize: (request) => authorized(request, configuredHost.orchestrationAccessToken),
        onError: (error) => {
          workerLog(
            'error',
            '[memeloop-worker] orchestration HTTP handler failed',
            { error },
          );
        },
      });
      desktopNodeServer = http.createServer((request, response) => {
        void orchestrationHandler(request, response);
      });
      workerLog(
        'warn',
        '[memeloop-worker][desktop-as-node] after createNodeServer',
        { stage },
      );

      stage = 'listen';
      await new Promise<void>((resolve, reject) => {
        workerLog('warn', '[memeloop-worker][desktop-as-node] before listen', {
          stage,
          port,
        });
        const timeout = setTimeout(() => {
          reject(new Error('desktop node server listen timeout'));
        }, 5000);
        desktopNodeServer?.listen(port, listenHost, () => {
          resolve();
        });
        desktopNodeServer?.once('error', reject);
        desktopNodeServer?.once('listening', () => {
          clearTimeout(timeout);
        });
      });
      workerLog(
        'warn',
        '[memeloop-worker][desktop-as-node] after listen resolved',
        { stage },
      );
      stage = 'read-address';
      const address = desktopNodeServer?.address();
      if (address && typeof address === 'object') {
        desktopNodePort = address.port;
      }
      desktopNodeStarted = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`desktop node start failed at stage=${stage}: ${message}`, {
        cause: error,
      });
    } finally {
      desktopNodeStartPromise = undefined;
    }
  })();

  await desktopNodeStartPromise;
}

async function stopDesktopHttpServer(): Promise<void> {
  if (desktopNodeServer) {
    const server = desktopNodeServer;
    desktopNodeServer = undefined;
    desktopNodeStarted = false;
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      })
    );
  }
  desktopNodePort = undefined;
}

async function shutdownDesktopNode(): Promise<void> {
  await stopDesktopHttpServer();
  for (const controller of promptPreviewPrepareOperations.values()) {
    controller.abort(new Error('MemeLoop worker is shutting down'));
  }
  promptPreviewPrepareOperations.clear();
  approvalRequestCleanup?.();
  approvalRequestCleanup = undefined;
  conversationMutationObserverCleanup?.();
  conversationMutationObserverCleanup = undefined;
  const stop = stopNodeRuntime;
  stopNodeRuntime = undefined;
  try {
    await stop?.();
  } finally {
    runtime = undefined;
    storage = undefined;
    runtimeContext = undefined;
    deviceRpcHandler = undefined;
    scheduledTaskRpcHandler = undefined;
    orchestrationClient = undefined;
    runtimeToolIds = [];
    runtimeAgentDefinitions = [];
    runtimeInitPromise = undefined;
  }
}

const workerState = {
  initializedAt: Date.now(),
};

const memeloopWorker = {
  configureHost: async (config: DesktopHostConfig) => {
    if (runtimeInitPromise || runtime) {
      throw new Error('MemeLoop worker is already initialized');
    }
    if (!path.isAbsolute(config.dataDir)) {
      throw new Error('MemeLoop worker dataDir must be absolute');
    }
    if (!path.isAbsolute(config.sqliteNativeBinding)) {
      throw new Error('MemeLoop worker SQLite native binding path must be absolute');
    }
    if (config.orchestrationAccessToken.length < 32) {
      throw new Error('MemeLoop orchestration access token is too short');
    }
    if (!config.localPeerId.startsWith('12D3Koo')) {
      throw new Error('MemeLoop worker requires the host DeviceNetwork PeerId');
    }
    await ensureMemeLoopWorkerDataDirectory(config.dataDir);
    hostConfig = { ...config };
    return { ok: true };
  },
  subscribeLogs: () => logSubject.asObservable(),
  subscribeConversationMutations: () =>
    new Observable<ConversationMutationWake>(observer => {
      let disposed = false;
      const subscription = conversationMutationSubject.subscribe(observer);
      void ensureRuntimeInitialized().catch((error: unknown) => {
        if (!disposed) observer.error(error);
        subscription.unsubscribe();
      });
      return () => {
        disposed = true;
        subscription.unsubscribe();
      };
    }),
  ping: async () => {
    workerLog('warn', '[memeloop-worker] ping');
    await ensureRuntimeInitialized();
    return {
      ok: true,
      initializedAt: workerState.initializedAt,
      nodeId: localNodeId,
      port: desktopNodePort,
      orchestrationEndpoint: desktopNodePort
        ? `http://127.0.0.1:${desktopNodePort}/v1/orchestration/resources`
        : undefined,
    };
  },
  startServer: async (port: number) => {
    await ensureDesktopNodeStarted(port);
    return {
      running: desktopNodeStarted,
      port: desktopNodePort,
      nodeId: localNodeId,
    };
  },
  stopServer: async () => {
    await stopDesktopHttpServer();
    return { ok: true };
  },
  shutdown: async () => {
    await shutdownDesktopNode();
    return { ok: true };
  },
  /**
   * Execute an authenticated DeviceNetwork RPC against the real UtilityProcess
   * runtime. The main process deliberately owns no second MemeLoop runtime.
   */
  handleDeviceRpc: async (input: DeviceRpcHandlerInput) => {
    await ensureRuntimeInitialized();
    if (!runtime || !storage) throw new Error('MemeLoop runtime did not initialize');
    const activeRuntime = runtime;
    if (
      typeof storage.getMessagePage !== 'function' ||
      typeof storage.getMessageById !== 'function' ||
      typeof storage.getMessageIdentity !== 'function' ||
      typeof storage.readMessageDetailRange !== 'function' ||
      typeof storage.getMessageWindowAround !== 'function' ||
      typeof storage.getConversationTimelinePage !== 'function' ||
      typeof storage.readAttachmentRange !== 'function'
    ) throw new Error('MemeLoop SQLite v2 bounded storage ports are unavailable');
    deviceRpcHandler ??= createAgentRuntimeDeviceRpcHandler({
      runtime: activeRuntime,
      storage: storage as AgentRuntimeRpcStorage,
      projections: createDesktopAgentRuntimeProjectionStore(storage as AgentRuntimeRpcStorage),
      retryTurn: createDesktopRetryTurnHandler(activeRuntime),
      getAgentDefinitions: () => runtimeAgentDefinitions,
      scheduledTaskHandler: scheduledTaskRpcHandler ??= createDesktopScheduledTaskRpcHandler(
        createMainScheduledTaskServiceBridge(),
        localNodeId,
      ),
      localNodeId,
    });
    return deviceRpcHandler(input);
  },
  /**
   * Typed workerAdapter calls are structured-cloned, so the CLI SQLite handle
   * never leaves this UtilityProcess and can remain the single sync/runtime
   * source of truth.
   */
  storageCall: async (method: string, arguments_: unknown[]) => {
    await ensureRuntimeInitialized();
    if (!storage) throw new Error('MemeLoop storage did not initialize');
    const callable = (storage as unknown as Record<string, unknown>)[method];
    if (typeof callable !== 'function') {
      throw new Error(`memeloop_storage_method_not_supported:${method}`);
    }
    return (callable as (...values: unknown[]) => unknown).apply(storage, arguments_);
  },
  preparePromptPreviewExecution: async (input: {
    conversationId: string;
    requestId: string;
    inputText?: string;
  }) => {
    await ensureRuntimeInitialized();
    if (!runtimeContext) throw new Error('MemeLoop runtime context did not initialize');
    const abortController = new AbortController();
    const previous = promptPreviewPrepareOperations.get(input.requestId);
    previous?.abort(new Error('prompt preview request superseded'));
    promptPreviewPrepareOperations.set(input.requestId, abortController);
    try {
      const prepared = await prepareAgentExecutionModelRequest(runtimeContext, {
        conversationId: input.conversationId,
        stream: false,
        signal: abortController.signal,
        ...(input.inputText === undefined ? {} : { inputText: input.inputText }),
      });
      abortController.signal.throwIfAborted();
      return promptPreviewAuditStore.createSession({ request: prepared.prepared.request });
    } finally {
      if (promptPreviewPrepareOperations.get(input.requestId) === abortController) {
        promptPreviewPrepareOperations.delete(input.requestId);
      }
    }
  },
  getPromptPreviewAuditPage: async (request: PromptPreviewAuditPageRequest) => promptPreviewAuditStore.getPage(request),
  getPromptPreviewAuditDetail: async (request: PromptPreviewAuditDetailRequest) => promptPreviewAuditStore.getDetail(request),
  releasePromptPreviewAuditSession: async (request: PromptPreviewAuditReleaseRequest) => {
    promptPreviewAuditStore.release(request);
  },
  cancelPromptPreview: async (requestId: string) => {
    promptPreviewPrepareOperations.get(requestId)?.abort(new Error('prompt preview cancelled'));
    promptPreviewPrepareOperations.delete(requestId);
  },
  getDeviceCapabilities: async (): Promise<DeviceCapabilities> => {
    await ensureRuntimeInitialized();
    if (!runtime || !storage) throw new Error('MemeLoop runtime did not initialize');
    // The worker's concrete runtime owns the built-in and host-bridged tool
    // registry. Avoid advertising tools by guessing from the Electron host.
    return {
      tools: [...runtimeToolIds],
      mcpServers: [],
      // MemeLoop App deliberately has no TidGi workspace/wiki runtime. A
      // future TiddlyWiki host must provide an explicit wiki port before this
      // capability can be advertised; pretending it exists routes agents into
      // tools that can only throw at runtime.
      hasWiki: false,
      agentLoop: true,
      imChannels: [],
      wikis: [],
    };
  },
  createAgent: async (
    definitionId: string,
    initialMessage?: string,
    conversationId?: string,
  ) => {
    workerLog('warn', '[memeloop-worker] createAgent', { definitionId });
    await ensureDesktopNodeStarted();
    try {
      if (!runtime || !storage) {
        throw new Error('MemeLoop runtime did not initialize');
      }
      await storage.getAgentDefinition(definitionId);
      workerLog(
        'warn',
        '[memeloop-worker] createAgent runtime.createAgent start',
        { definitionId },
      );
      const created = await runtime.createAgent({
        definitionId,
        initialMessage,
        conversationId,
      });
      workerLog(
        'warn',
        '[memeloop-worker] createAgent runtime.createAgent done',
        { definitionId, conversationId: created?.conversationId },
      );
      return created;
    } catch (error) {
      workerLog('error', '[memeloop-worker] createAgent failed', {
        definitionId,
        error,
      });
      throw error;
    }
  },
  sendMessage: async (
    conversationId: string,
    message: string,
    identity?: {
      requestId: string;
      turnId: string;
      userMessage?: Partial<ChatMessage> & { messageId: string; turnId: string; content: string };
    },
  ) => {
    workerLog('warn', '[memeloop-worker] sendMessage start', {
      conversationId,
    });
    await ensureDesktopNodeStarted();
    if (!runtime) throw new Error('MemeLoop runtime did not initialize');
    try {
      const accepted = await runtime.sendMessage({
        conversationId,
        message,
        ...(identity
          ? {
            requestId: identity.requestId,
            turnId: identity.turnId,
            userMessage: identity.userMessage ?? {
              messageId: identity.turnId,
              turnId: identity.turnId,
              content: message,
            },
          }
          : {}),
      }) as unknown as { runId: string; turnId: string; conversationId: string };
      workerLog('warn', '[memeloop-worker] sendMessage done', {
        conversationId,
      });
      return accepted;
    } catch (error) {
      workerLog('error', '[memeloop-worker] sendMessage failed', {
        conversationId,
        error,
      });
      throw error;
    }
  },
  waitForRunTerminal: async (runId: string) => {
    if (!runId) throw new Error('scheduled_agent_run_id_missing');
    await ensureRuntimeInitialized();
    if (!runtime) throw new Error('MemeLoop runtime did not initialize');
    for (;;) {
      const status = await runtime.getRunStatus(runId);
      if (!status) throw new Error('scheduled_agent_run_missing');
      if (status.state === 'completed') return status;
      if (status.state === 'failed' || status.state === 'cancelled') {
        const error = new Error(status.error?.messageKey ?? `scheduled_agent_run_${status.state}`);
        Object.assign(error, {
          code: status.error?.code,
          diagnosticId: status.error?.diagnosticId,
          retryable: status.error?.retryable,
        });
        throw error;
      }
      await new Promise<void>(resolve => setTimeout(resolve, 250));
    }
  },
  cancelRun: async (conversationId: string, runId?: string) => {
    workerLog('warn', '[memeloop-worker] cancelRun', { conversationId, runId });
    conversationCancellation.add(conversationId);
    if (!runtime) throw new Error('MemeLoop runtime did not initialize');
    if (runId) {
      return { ok: await runtime.cancelRun(runId) };
    }
    // Handles the short accept/cancel race before the accepted run id crosses
    // the worker boundary. The runtime owns the authoritative active-run set.
    await runtime.cancelAgent(conversationId);
    return { ok: true };
  },
  subscribeToUpdates: (conversationId: string) => {
    if (!runtime) throw new Error('MemeLoop runtime not initialized');
    const activeRuntime = runtime;
    return new Observable<RuntimeUpdate>((observer) => {
      workerLog('warn', '[memeloop-worker] subscribeToUpdates start', {
        conversationId,
      });
      const dispose = activeRuntime.subscribeToUpdates(
        conversationId,
        update => {
          observer.next({ conversationId, update });
        },
      );

      let set = customUpdateListenersByConversationId.get(conversationId);
      if (!set) {
        set = new Set();
        customUpdateListenersByConversationId.set(conversationId, set);
      }

      const listener = (update: WorkerCustomUpdate) => {
        observer.next({ conversationId, update });
      };
      set.add(listener);

      return () => {
        workerLog('warn', '[memeloop-worker] subscribeToUpdates dispose', {
          conversationId,
        });
        set?.delete(listener);
        if (set && set.size === 0) {
          customUpdateListenersByConversationId.delete(conversationId);
        }
        dispose();
      };
    });
  },
  resolveAskQuestion: async (
    _conversationId: string,
    questionId: string,
    answer: string,
  ) => {
    workerLog('warn', '[memeloop-worker] resolveAskQuestion', { questionId });
    await ensureRuntimeInitialized();
    const resolved = runtimeContext?.questionWaits?.resolveQuestionAnswer(questionId, answer) ?? false;
    return { resolved };
  },
  resolveToolApproval: async (
    approvalId: string,
    decision: 'allow' | 'deny',
  ) => {
    workerLog('warn', '[memeloop-worker] resolveToolApproval', {
      approvalId,
      decision,
    });
    await ensureRuntimeInitialized();
    const broker = runtimeContext?.toolApprovals;
    const request = broker?.getPendingApprovals().find(candidate => candidate.approvalId === approvalId);
    const ok = !!request && !!broker?.resolveApproval({
      approvalId: request.approvalId,
      runtimeId: request.runtimeId,
      runId: request.runId,
      conversationId: request.conversationId,
      agentId: request.agentId,
      toolName: request.toolName,
      parameterDigest: request.parameterDigest,
      decision,
    });
    return { ok };
  },
};

export type MemeLoopWorker = typeof memeloopWorker;

process.on('beforeExit', () => {
  void shutdownDesktopNode();
});

handleWorkerMessages(memeloopWorker);
