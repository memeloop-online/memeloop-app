import 'source-map-support/register';

import type { ModelMessage } from 'ai';
import { nanoid } from 'nanoid';
import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { Observable, Subject } from 'rxjs';

import { getWorkerParentPort, handleWorkerMessages, safePostMessage } from '@services/libs/workerAdapter';

import {
  type AgentDefinition,
  type AgentRuntimeRpcStorage,
  type ChatMessage,
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
import { createDesktopDeviceRpcHandlers } from './desktopDeviceRpcHandlers';
import { createLlmCorrelatedRuntime, resolveLlmConversationId, runWithLlmConversation } from './llmRequestCorrelation';
import { createDesktopRetryTurnHandler } from './retryTurn';
import { createDesktopScheduledTaskRpcHandler, type ScheduledTaskServicePort } from './scheduledTaskRpcStore';
import type {
  CreateScheduledTaskInput,
  ListScheduledTasksPageForAgentInput,
  ScheduledTask,
  ScheduledTaskCallOptions,
  ScheduledTaskScope,
  UpdateScheduledTaskInput,
} from './scheduledTaskTypes';
import { createDesktopAgentRuntimeProjectionStore } from './sqliteAgentRuntimeProjectionStore';
import { TerminalSessionManager } from './terminal/sessionManager';
import { ensureMemeLoopWorkerDataDirectory } from './workerDataDirectory';

// Electron UtilityProcess exposes `process.parentPort`; the worker adapter
// normalizes it to the transport shape used by the RPC adapter.  The runtime
// itself never creates or derives a second identity.
const parentPort = getWorkerParentPort();

type WorkerLogEvent = {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  meta?: unknown;
};

const MAX_WORKER_LOG_MESSAGE_BYTES = 4 * 1024;
const MAX_WORKER_LOG_META_BYTES = 8 * 1024;
const MAX_WORKER_LOG_DEPTH = 6;
const MAX_WORKER_LOG_EVENTS_PER_SECOND = 100;
let workerLogWindowStartedAt = Date.now();
let workerLogWindowCount = 0;

function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.byteLength <= maxBytes) return value;
  return `${encoded.subarray(0, maxBytes).toString('utf8')}…`;
}

function sanitizeWorkerLogValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > MAX_WORKER_LOG_DEPTH) return '[depth limit]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncateUtf8(value, 2 * 1024);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateUtf8(value.message, 2 * 1024),
      stack: value.stack ? truncateUtf8(value.stack, 4 * 1024) : undefined,
    };
  }
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    return { type: 'binary', bytes: value.byteLength };
  }
  if (value instanceof ArrayBuffer) return { type: 'binary', bytes: value.byteLength };
  if (typeof value === 'symbol') return value.description ?? '[symbol]';
  if (typeof value === 'function') return value.name ? `[function ${value.name}]` : '[function]';
  if (typeof value !== 'object') return '[unsupported]';

  if (seen.has(value)) return '[circular]';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.slice(0, 32).map(item => sanitizeWorkerLogValue(item, depth + 1, seen));
    }
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 32)) {
      result[truncateUtf8(key, 256)] = sanitizeWorkerLogValue(item, depth + 1, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function boundedWorkerLogMeta(value: unknown): unknown {
  const sanitized = sanitizeWorkerLogValue(value);
  try {
    const encoded = JSON.stringify(sanitized);
    if (encoded === undefined || Buffer.byteLength(encoded, 'utf8') <= MAX_WORKER_LOG_META_BYTES) {
      return sanitized;
    }
    return {
      truncated: true,
      preview: truncateUtf8(encoded, MAX_WORKER_LOG_META_BYTES - 64),
    };
  } catch {
    return { truncated: true, preview: '[unserializable]' };
  }
}

// Use the existing workerAdapter Observable streaming channel for logs,
// so we don't invent a one-off postMessage protocol.
const logSubject = new Subject<WorkerLogEvent>();
const conversationMutationSubject = new Subject<ConversationMutationWake>();
function workerLog(
  level: WorkerLogEvent['level'],
  message: string,
  meta?: unknown,
): void {
  const now = Date.now();
  if (now - workerLogWindowStartedAt >= 1000) {
    workerLogWindowStartedAt = now;
    workerLogWindowCount = 0;
  }
  if (workerLogWindowCount >= MAX_WORKER_LOG_EVENTS_PER_SECOND) return;
  workerLogWindowCount += 1;
  try {
    logSubject.next({
      level,
      message: truncateUtf8(message, MAX_WORKER_LOG_MESSAGE_BYTES),
      meta: meta === undefined ? undefined : boundedWorkerLogMeta(meta),
    });
  } catch {
    // Logging must never break runtime work, but a failed observer is still
    // observable in the bounded child stderr stream.
    process.stderr.write('[memeloop-utility-process] worker log observer failed\n');
  }
}

function postToParent(message: unknown): boolean {
  return parentPort ? safePostMessage(parentPort, message) : false;
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

function rejectPendingMainRequests(error: Error): void {
  for (const pending of pendingMainToolList.values()) pending.reject(error);
  for (const pending of pendingMainToolCall.values()) pending.reject(error);
  for (const pending of pendingMainScheduledTaskCall.values()) pending.reject(error);
  pendingMainToolList.clear();
  pendingMainToolCall.clear();
  pendingMainScheduledTaskCall.clear();
  for (const pending of pendingMainLlmChat.values()) {
    pending.error = error;
    pending.done = true;
    while (pending.waiters.length > 0) {
      pending.waiters.shift()?.({ value: undefined, done: true });
    }
  }
  pendingMainLlmChat.clear();
}

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
    if (m.type === 'memeloop-tool-list-error') {
      const pending = pendingMainToolList.get(m.id);
      if (!pending) return;
      pendingMainToolList.delete(m.id);
      const error = new Error(m.error?.message ?? 'memeloop-tool-list failed');
      error.name = m.error?.name ?? 'Error';
      error.stack = m.error?.stack;
      pending.reject(error);
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
    if (!postToParent({ type: 'memeloop-tool-list', id })) {
      pendingMainToolList.delete(id);
      clearTimeout(timeout);
      reject(new Error('memeloop_tool_list_transport_unavailable'));
    }
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
    if (!postToParent({ type: 'memeloop-tool-call', id, toolId, args: arguments_ })) {
      pendingMainToolCall.delete(id);
      clearTimeout(timeout);
      reject(new Error('memeloop_tool_call_transport_unavailable'));
    }
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
      postToParent({ type: 'memeloop-scheduled-task-cancel', id });
      finish(() => {
        reject(signal?.reason instanceof Error ? signal.reason : new Error('scheduled_task_call_aborted'));
      });
    };
    const timeout = setTimeout(() => {
      postToParent({ type: 'memeloop-scheduled-task-cancel', id });
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
    else if (!postToParent({ type: 'memeloop-scheduled-task-call', id, method, arguments: arguments_ })) {
      finish(() => {
        reject(new Error('memeloop_scheduled_task_transport_unavailable'));
      });
    }
  });
}

function createMainScheduledTaskServiceBridge(): ScheduledTaskServicePort {
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
    getCronPreviewDates: (expression: string, timezone?: string, count?: number) => callMainScheduledTask<string[]>('getCronPreviewDates', [expression, timezone, count]),
  } satisfies ScheduledTaskServicePort;
  return bridge;
}

async function* callMainLlmChat(
  request: MainLlmChatRequest,
): AsyncGenerator<string, void, unknown> {
  const id = `llm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const pending: PendingLlmStream = { deltas: [], waiters: [], done: false };
  pendingMainLlmChat.set(id, pending);
  if (!postToParent({ type: 'memeloop-llm-chat', id, request })) {
    pendingMainLlmChat.delete(id);
    throw new Error('memeloop_llm_chat_transport_unavailable');
  }

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
    workerLog('warn', '[memeloop-utility-process]', { a });
  },
  error: (...a: unknown[]) => {
    workerLog('error', '[memeloop-utility-process]', { a });
  },
};

let fatalExitScheduled = false;
let gracefulShutdownPromise: Promise<void> | undefined;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5_000;

function shutdownDesktopNodeWithDeadline(): Promise<void> {
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadlinePromise = new Promise<never>((_, reject) => {
    deadlineTimer = setTimeout(() => {
      reject(new Error('MemeLoop UtilityProcess graceful shutdown timed out'));
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
    deadlineTimer.unref?.();
  });
  return Promise.race([shutdownDesktopNode(), deadlinePromise]).finally(() => {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  });
}

function scheduleFatalExit(kind: string, reason: unknown): void {
  if (fatalExitScheduled) return;
  fatalExitScheduled = true;
  workerLog('error', `[memeloop-utility-process] ${kind}`, { reason });
  rejectPendingMainRequests(new Error(`memeloop_utility_process_${kind}`));
  // Give the bounded fatal log a turn to cross the parent port, then exit
  // deterministically. Leaving a process alive after uncaught state is unsafe.
  setImmediate(() => {
    void shutdownDesktopNode().catch((error: unknown) => {
      workerLog('error', '[memeloop-utility-process] fatal shutdown failed', { error });
    });
    process.exit(1);
  });
}

function handleTerminationSignal(signal: 'SIGTERM' | 'SIGHUP' | 'SIGINT'): void {
  if (gracefulShutdownPromise || fatalExitScheduled) return;
  workerLog('info', '[memeloop-utility-process] termination requested', { signal });
  rejectPendingMainRequests(new Error(`memeloop_utility_process_${signal.toLowerCase()}`));
  gracefulShutdownPromise = shutdownDesktopNodeWithDeadline()
    .then(() => undefined)
    .catch((error: unknown) => {
      workerLog('error', '[memeloop-utility-process] graceful shutdown failed', { error });
      process.exitCode = 1;
    })
    .finally(() => {
      process.exit(process.exitCode ?? 0);
    });
}

process.on('uncaughtException', error => {
  scheduleFatalExit('uncaughtException', error);
});
process.on('unhandledRejection', reason => {
  scheduleFatalExit('unhandledRejection', reason);
});
for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT'] as const) {
  process.on(signal, () => {
    handleTerminationSignal(signal);
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

  workerLog('warn', '[memeloop-utility-process] emitCustomUpdate', {
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
      workerLog('warn', '[memeloop-utility-process] custom update listener failed');
    }
  }
}

const conversationCancellation = new Set<string>();

const llmProvider = {
  name: 'memeloop-app-worker',
  model: undefined,
  chat: async function*(request: unknown) {
    const request_ = request as {
      messages?: ModelMessage[];
      conversationId?: string;
    };
    for await (
      const delta of callMainLlmChat({
        conversationId: resolveLlmConversationId(request_),
        messages: request_.messages ?? [],
      })
    ) {
      yield { type: 'text-delta' as const, text: delta, id: nanoid() };
    }
  },
};

// The host config supplies the sole DeviceNetwork identity before runtime
// initialization. Keep this unset until then instead of minting a child key.
let localNodeId = '';
const terminalManager = new TerminalSessionManager();

let runtime: NodeRuntimeResult['runtime'] | undefined;
let storage: NodeRuntimeResult['storage'] | undefined;
let runtimeContext: NodeRuntimeResult['context'] | undefined;
let approvalRequestCleanup: (() => void) | undefined;
let deviceRpcHandler: DeviceRpcHandler | undefined;
let localDeviceRpcHandler: DeviceRpcHandler | undefined;
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

function isAgentRuntimeRpcStorage(value: unknown): value is AgentRuntimeRpcStorage {
  if (!value || typeof value !== 'object') return false;
  return [
    'getMessagePage',
    'getMessageById',
    'getMessageIdentity',
    'readMessageDetailRange',
    'getMessageWindowAround',
    'getConversationTimelinePage',
    'readAttachmentRange',
  ].every(method => typeof Reflect.get(value, method) === 'function');
}

function isCallable(value: unknown): value is (...arguments_: unknown[]) => unknown {
  return typeof value === 'function';
}

function getDesktopDeviceRpcHandler(localOnly: boolean): DeviceRpcHandler {
  const cached = localOnly ? localDeviceRpcHandler : deviceRpcHandler;
  if (cached) return cached;
  const activeRuntime = runtime;
  const activeStorage = storage;
  if (!activeRuntime || !activeStorage) throw new Error('MemeLoop runtime did not initialize');
  if (!isAgentRuntimeRpcStorage(activeStorage)) {
    throw new Error('MemeLoop SQLite v2 bounded storage ports are unavailable');
  }
  const retryTurn = createDesktopRetryTurnHandler(activeRuntime);
  const handlers = createDesktopDeviceRpcHandlers({
    runtime: createLlmCorrelatedRuntime(activeRuntime),
    storage: activeStorage,
    projections: createDesktopAgentRuntimeProjectionStore(activeStorage),
    retryTurn: (request, requestPeerId) =>
      runWithLlmConversation(
        request.conversationId,
        () => retryTurn(request, requestPeerId),
      ),
    getAgentDefinitions: () => runtimeAgentDefinitions,
    scheduledTaskHandler: scheduledTaskRpcHandler ??= createDesktopScheduledTaskRpcHandler(
      createMainScheduledTaskServiceBridge(),
      localNodeId,
    ),
    localNodeId,
  });
  deviceRpcHandler = handlers.network;
  localDeviceRpcHandler = handlers.local;
  return localOnly ? localDeviceRpcHandler : deviceRpcHandler;
}

function requireHostConfig(): DesktopHostConfig {
  if (!hostConfig) {
    throw new Error('MemeLoop UtilityProcess host configuration is required before initialization');
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
    workerLog('info', '[memeloop-utility-process] runtime module loaded');

    const mainBridgeToolIds = await requestMainBridgeToolList().catch(
      (error: unknown) => {
        workerLog(
          'warn',
          '[memeloop-utility-process] failed to load main bridge tool list',
          { error },
        );
        return [] as string[];
      },
    );
    workerLog('info', '[memeloop-utility-process] main bridge tools loaded', { count: mainBridgeToolIds.length });

    workerLog('info', '[memeloop-utility-process] createNodeRuntime starting');
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
    workerLog('info', '[memeloop-utility-process] createNodeRuntime completed');

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
      const environmentPort = parseInt(process.env.MEMELOOP_WORKER_PORT ?? '', 10);
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
        '[memeloop-utility-process][desktop-as-node] ensureDesktopNodeStarted',
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
        path: '/v2/orchestration/resources',
        authorize: (request) => authorized(request, configuredHost.orchestrationAccessToken),
        onError: (error) => {
          workerLog(
            'error',
            '[memeloop-utility-process] orchestration HTTP handler failed',
            { error },
          );
        },
      });
      desktopNodeServer = http.createServer((request, response) => {
        void orchestrationHandler(request, response);
      });
      workerLog(
        'warn',
        '[memeloop-utility-process][desktop-as-node] after createNodeServer',
        { stage },
      );

      stage = 'listen';
      await new Promise<void>((resolve, reject) => {
        workerLog('warn', '[memeloop-utility-process][desktop-as-node] before listen', {
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
        '[memeloop-utility-process][desktop-as-node] after listen resolved',
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

let shutdownDesktopNodePromise: Promise<void> | undefined;

async function shutdownDesktopNode(): Promise<void> {
  if (shutdownDesktopNodePromise) return shutdownDesktopNodePromise;
  shutdownDesktopNodePromise = (async () => {
    await stopDesktopHttpServer();
    for (const controller of promptPreviewPrepareOperations.values()) {
      controller.abort(new Error('MemeLoop UtilityProcess is shutting down'));
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
  })();
  try {
    await shutdownDesktopNodePromise;
  } finally {
    shutdownDesktopNodePromise = undefined;
  }
}

const workerState = {
  initializedAt: Date.now(),
};

const memeloopWorker = {
  configureHost: async (config: DesktopHostConfig) => {
    if (runtimeInitPromise || runtime) {
      throw new Error('MemeLoop UtilityProcess is already initialized');
    }
    if (!path.isAbsolute(config.dataDir)) {
      throw new Error('MemeLoop UtilityProcess dataDir must be absolute');
    }
    if (!path.isAbsolute(config.sqliteNativeBinding)) {
      throw new Error('MemeLoop UtilityProcess SQLite native binding path must be absolute');
    }
    if (config.orchestrationAccessToken.length < 32) {
      throw new Error('MemeLoop orchestration access token is too short');
    }
    if (!config.localPeerId.startsWith('12D3Koo')) {
      throw new Error('MemeLoop UtilityProcess requires the host DeviceNetwork PeerId');
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
    workerLog('warn', '[memeloop-utility-process] ping');
    await ensureRuntimeInitialized();
    return {
      ok: true,
      initializedAt: workerState.initializedAt,
      nodeId: localNodeId,
      port: desktopNodePort,
      orchestrationEndpoint: desktopNodePort
        ? `http://127.0.0.1:${desktopNodePort}/v2/orchestration/resources`
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
    return getDesktopDeviceRpcHandler(false)(input);
  },
  /** Main-process-only counterpart: it never accepts DeviceNetwork traffic. */
  handleLocalDeviceRpc: async (input: DeviceRpcHandlerInput) => {
    await ensureRuntimeInitialized();
    return getDesktopDeviceRpcHandler(true)(input);
  },
  /**
   * Typed workerAdapter calls are structured-cloned, so the CLI SQLite handle
   * never leaves this UtilityProcess and can remain the single sync/runtime
   * source of truth.
   */
  storageCall: async (method: string, arguments_: unknown[]) => {
    await ensureRuntimeInitialized();
    if (!storage) throw new Error('MemeLoop storage did not initialize');
    const callable: unknown = Reflect.get(storage, method);
    if (!isCallable(callable)) {
      throw new Error(`memeloop_storage_method_not_supported:${method}`);
    }
    return Reflect.apply(callable, storage, arguments_);
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
    workerLog('warn', '[memeloop-utility-process] createAgent', { definitionId });
    await ensureDesktopNodeStarted();
    try {
      const activeRuntime = runtime;
      const activeStorage = storage;
      if (!activeRuntime || !activeStorage) {
        throw new Error('MemeLoop runtime did not initialize');
      }
      await activeStorage.getAgentDefinition(definitionId);
      workerLog(
        'warn',
        '[memeloop-utility-process] createAgent runtime.createAgent start',
        { definitionId },
      );
      const create = () =>
        activeRuntime.createAgent({
          definitionId,
          initialMessage,
          conversationId,
        });
      const created = conversationId === undefined
        ? await create()
        : await runWithLlmConversation(conversationId, create);
      workerLog(
        'warn',
        '[memeloop-utility-process] createAgent runtime.createAgent done',
        { definitionId, conversationId: created?.conversationId },
      );
      return created;
    } catch (error) {
      workerLog('error', '[memeloop-utility-process] createAgent failed', {
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
    workerLog('warn', '[memeloop-utility-process] sendMessage start', {
      conversationId,
    });
    await ensureDesktopNodeStarted();
    const activeRuntime = runtime;
    if (!activeRuntime) throw new Error('MemeLoop runtime did not initialize');
    try {
      const accepted = await runWithLlmConversation(conversationId, () =>
        activeRuntime.sendMessage({
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
        }));
      workerLog('warn', '[memeloop-utility-process] sendMessage done', {
        conversationId,
      });
      return accepted;
    } catch (error) {
      workerLog('error', '[memeloop-utility-process] sendMessage failed', {
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
    workerLog('warn', '[memeloop-utility-process] cancelRun', { conversationId, runId });
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
      workerLog('warn', '[memeloop-utility-process] subscribeToUpdates start', {
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
        workerLog('warn', '[memeloop-utility-process] subscribeToUpdates dispose', {
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
    workerLog('warn', '[memeloop-utility-process] resolveAskQuestion', { questionId });
    await ensureRuntimeInitialized();
    const resolved = runtimeContext?.questionWaits?.resolveQuestionAnswer(questionId, answer) ?? false;
    return { resolved };
  },
  resolveToolApproval: async (
    approvalId: string,
    decision: 'allow' | 'deny',
  ) => {
    workerLog('warn', '[memeloop-utility-process] resolveToolApproval', {
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
  void shutdownDesktopNode().catch((error: unknown) => {
    workerLog('error', '[memeloop-utility-process] beforeExit shutdown failed', { error });
  });
});

handleWorkerMessages(memeloopWorker);
