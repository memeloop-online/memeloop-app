/**
 * Utility functions for the isolated agent runtime transport.
 *
 * The wire protocol is shared by the Electron UtilityProcess host and child.
 * Keeping the protocol transport-agnostic lets adapter tests use a small
 * in-memory message peer without introducing another runtime transport.
 */

import { cloneDeep } from 'lodash';
import { Observable, Subject, type Subscription } from 'rxjs';

/**
 * Structured-clone traffic crosses an Electron process boundary.  Keep one
 * conservative bound here so every caller (including host bridge calls) gets
 * the same failure mode before Electron attempts to clone an unbounded value.
 */
export const WORKER_IPC_MAX_BYTES = 16 * 1024 * 1024;
export const WORKER_IPC_MAX_DEPTH = 32;
const WORKER_IPC_MAX_ITEMS = 100_000;

interface MessagePeer {
  postMessage(message: unknown): void;
  on(event: string, listener: (...arguments_: unknown[]) => void): this;
}

export interface ParentPortPeer {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
}

type SizeState = {
  bytes: number;
  items: number;
  seen: WeakSet<object>;
};

const addSize = (state: SizeState, bytes: number): void => {
  state.bytes += bytes;
  if (state.bytes > WORKER_IPC_MAX_BYTES) {
    throw new Error(`worker_ipc_message_too_large:${state.bytes}`);
  }
};

/** Estimate structured-clone size while rejecting cycles/deep values. */
export function assertWorkerIpcValue(value: unknown): void {
  const state: SizeState = { bytes: 0, items: 0, seen: new WeakSet<object>() };
  const visit = (current: unknown, depth: number): void => {
    if (depth > WORKER_IPC_MAX_DEPTH) {
      throw new Error(`worker_ipc_max_depth_exceeded:${WORKER_IPC_MAX_DEPTH}`);
    }
    if (current === null || current === undefined) {
      addSize(state, 8);
      return;
    }
    switch (typeof current) {
      case 'string':
        addSize(state, Buffer.byteLength(current, 'utf8') + 8);
        return;
      case 'number':
      case 'boolean':
      case 'bigint':
        addSize(state, 16);
        return;
      case 'function':
      case 'symbol':
        throw new Error('worker_ipc_value_not_cloneable');
      default:
        break;
    }

    const objectValue = current;
    if (state.seen.has(objectValue)) {
      throw new Error('worker_ipc_cyclic_value');
    }
    state.seen.add(objectValue);
    try {
      if (Buffer.isBuffer(current) || ArrayBuffer.isView(current)) {
        addSize(state, current.byteLength + 16);
        return;
      }
      if (current instanceof ArrayBuffer) {
        addSize(state, current.byteLength + 16);
        return;
      }
      if (current instanceof Date) {
        addSize(state, 32);
        return;
      }
      if (current instanceof Map) {
        if (current.size > WORKER_IPC_MAX_ITEMS) throw new Error('worker_ipc_too_many_items');
        addSize(state, 16);
        for (const [key, mapValue] of current) {
          state.items += 1;
          if (state.items > WORKER_IPC_MAX_ITEMS) throw new Error('worker_ipc_too_many_items');
          visit(key, depth + 1);
          visit(mapValue, depth + 1);
        }
        return;
      }
      if (current instanceof Set) {
        if (current.size > WORKER_IPC_MAX_ITEMS) throw new Error('worker_ipc_too_many_items');
        addSize(state, 16);
        for (const item of current) {
          state.items += 1;
          if (state.items > WORKER_IPC_MAX_ITEMS) throw new Error('worker_ipc_too_many_items');
          visit(item, depth + 1);
        }
        return;
      }
      if (Array.isArray(current)) {
        if (current.length > WORKER_IPC_MAX_ITEMS) throw new Error('worker_ipc_too_many_items');
        addSize(state, 16);
        for (const item of current) {
          state.items += 1;
          if (state.items > WORKER_IPC_MAX_ITEMS) throw new Error('worker_ipc_too_many_items');
          visit(item, depth + 1);
        }
        return;
      }

      const entries = Object.entries(current as Record<string, unknown>);
      if (entries.length > WORKER_IPC_MAX_ITEMS) throw new Error('worker_ipc_too_many_items');
      addSize(state, 16);
      for (const [key, objectValue_] of entries) {
        state.items += 1;
        if (state.items > WORKER_IPC_MAX_ITEMS) throw new Error('worker_ipc_too_many_items');
        addSize(state, Buffer.byteLength(key, 'utf8') + 8);
        visit(objectValue_, depth + 1);
      }
    } finally {
      state.seen.delete(objectValue);
    }
  };
  visit(value, 0);
}

/** Post a bounded message without allowing transport errors to escape. */
export function safePostMessage(peer: Pick<MessagePeer, 'postMessage'> | ParentPortPeer, message: unknown): boolean {
  try {
    assertWorkerIpcValue(message);
    peer.postMessage(message);
    return true;
  } catch {
    return false;
  }
}

export interface WorkerMessage<T = unknown> {
  type: 'call' | 'response' | 'error' | 'stream' | 'complete' | 'unsubscribe';
  id?: string;
  method?: string;
  args?: unknown[];
  result?: T;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

export interface WorkerProxyOptions {
  /** Exact methods that return RxJS Observables. All other calls return Promises. */
  observableMethods?: readonly string[];
}

function unwrapMessage(message: unknown): WorkerMessage {
  if (message && typeof message === 'object' && 'data' in message) {
    const data = (message as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'type' in data) {
      return data as WorkerMessage;
    }
  }
  return message as WorkerMessage;
}

/**
 * Resolve the Electron UtilityProcess parent message port. Electron delivers
 * MessageEvent-like `{ data, ports }` objects to `process.parentPort`.
 */
export function getWorkerParentPort(): ParentPortPeer | null {
  const utilityParentPort = (process as NodeJS.Process & {
    parentPort?: {
      postMessage(message: unknown): void;
      on(event: 'message', listener: (event: unknown) => void): unknown;
    };
  }).parentPort;
  if (!utilityParentPort) return null;
  return {
    postMessage: message => {
      utilityParentPort.postMessage(message);
    },
    on: (_event, listener) => {
      utilityParentPort.on('message', event => {
        listener(unwrapMessage(event));
      });
    },
  };
}

/**
 * Create an isolated UtilityProcess proxy using the shared agent RPC protocol.
 * Usage: const proxy = createWorkerProxy<RuntimeType>(peer, options);
 */
type TypedWorkerProxyOptions<T> = WorkerProxyOptions & {
  /** Compile-time-only marker that keeps the proxy result type tied to its options. */
  readonly __workerProxyType?: T;
};

export function createWorkerProxy<T extends Record<string, (...arguments_: never[]) => unknown>>(
  peer: MessagePeer,
  options?: TypedWorkerProxyOptions<T>,
): T {
  const pendingCalls = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    subject?: Subject<unknown>;
  }>();

  // Listen to UtilityProcess messages
  peer.on('message', (rawMessage: unknown) => {
    const message = unwrapMessage(rawMessage);
    const pending = pendingCalls.get(message.id!);
    if (!pending) return;

    switch (message.type) {
      case 'response': {
        pending.resolve(message.result);
        pendingCalls.delete(message.id!);
        break;
      }
      case 'error': {
        const error = new Error(message.error?.message ?? 'Worker request failed');
        error.name = message.error?.name || 'WorkerError';
        error.stack = message.error?.stack;
        pending.reject(error);
        pendingCalls.delete(message.id!);
        break;
      }
      case 'stream':
        if (pending.subject) {
          pending.subject.next(message.result);
        }
        break;
      case 'complete':
        if (pending.subject) {
          pending.subject.complete();
          pendingCalls.delete(message.id!);
        }
        break;
    }
  });

  const rejectPending = (error: Error): void => {
    // Reject all pending calls
    for (const [id, pending] of pendingCalls.entries()) {
      pending.reject(error);
      if (pending.subject) {
        pending.subject.error(error);
      }
      pendingCalls.delete(id);
    }
  };

  peer.on('error', (...arguments_: unknown[]) => {
    const [errorOrType, location, report] = arguments_;
    const normalizedError = errorOrType instanceof Error
      ? errorOrType
      : new Error(
        typeof errorOrType === 'string'
          ? `${errorOrType}${typeof location === 'string' ? ` at ${location}` : ''}`
          : String(errorOrType),
      );
    if (report && typeof report === 'string') normalizedError.stack = report;
    rejectPending(normalizedError);
  });

  peer.on('exit', (...arguments_: unknown[]) => {
    const [code] = arguments_;
    const exitCode = typeof code === 'number' ? code : 'unknown';
    rejectPending(new Error(`MemeLoop UtilityProcess exited with code ${exitCode}`));
  });

  // Create proxy object
  return new Proxy({} as T, {
    get: (_target, method: string | symbol) => {
      // Prevent proxy from being treated as a Promise
      // When JS engine checks if object is thenable, it accesses 'then' property
      if (method === 'then' || method === 'catch' || method === 'finally') {
        return undefined;
      }

      // Symbol properties should not be proxied
      if (typeof method === 'symbol') {
        return undefined;
      }

      return (...arguments_: unknown[]) => {
        const id = `${method}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        // Observable methods are part of the explicit runtime contract. Every
        // unlisted method is a request/response Promise; never infer streaming
        // behavior from a method name.
        const isObservable = options?.observableMethods?.includes(method) ?? false;

        if (isObservable) {
          // Return Observable for streaming responses
          return new Observable((observer) => {
            const subject = new Subject();
            subject.subscribe(observer);

            pendingCalls.set(id, {
              resolve: () => {},
              reject: (error) => {
                subject.error(error);
              },
              subject,
            });

            try {
              // Deep clone arguments to ensure they can be serialized. Keep the
              // clone inside this try so cycles/unsupported values reject the
              // call and cannot leave a pending entry behind.
              const serializedArguments = arguments_.map((argument) => cloneDeep(argument));
              assertWorkerIpcValue({
                type: 'call',
                id,
                method,
                args: serializedArguments,
              });
              peer.postMessage({
                type: 'call',
                id,
                method,
                args: serializedArguments,
              });
            } catch (error) {
              pendingCalls.delete(id);
              subject.error(error instanceof Error ? error : new Error(String(error)));
            }

            return () => {
              pendingCalls.delete(id);
              // Propagate cancellation to the child so long-lived runtime
              // subscriptions do not survive a renderer/service unsubscribe.
              safePostMessage(peer, {
                type: 'unsubscribe',
                id,
              });
            };
          });
        } else {
          // Return Promise for regular calls
          return new Promise((resolve, reject) => {
            pendingCalls.set(id, { resolve, reject });

            try {
              // Deep clone arguments to ensure they can be serialized. Keep the
              // clone inside this try so cycles/unsupported values reject the
              // call and cannot leave a pending entry behind.
              const serializedArguments = arguments_.map((argument) => cloneDeep(argument));
              assertWorkerIpcValue({
                type: 'call',
                id,
                method,
                args: serializedArguments,
              });
              peer.postMessage({
                type: 'call',
                id,
                method,
                args: serializedArguments,
              });
            } catch (error) {
              pendingCalls.delete(id);
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          });
        }
      };
    },
  });
}

/**
 * UtilityProcess-side message handler.
 * Usage in the child: handleWorkerMessages({ methodName: implementation });
 */
export function handleWorkerMessages(
  methods: Record<string, (...arguments_: never[]) => unknown>,
): void {
  const parentPort = getWorkerParentPort();

  if (!parentPort) {
    throw new Error('This function must be called in the MemeLoop UtilityProcess');
  }

  const activeSubscriptions = new Map<string, Subscription>();
  const post = (message: unknown): boolean => safePostMessage(parentPort, message);
  const postReply = (message: unknown, id?: string): boolean => {
    if (post(message)) return true;
    // Always give the caller a bounded terminal response when a result itself
    // cannot cross the structured-clone boundary.
    if (id) {
      post({
        type: 'error',
        id,
        error: {
          message: 'worker_ipc_response_too_large_or_not_cloneable',
          name: 'WorkerTransportError',
        },
      });
    }
    return false;
  };

  parentPort.on('message', async (rawMessage: unknown) => {
    const message = unwrapMessage(rawMessage);
    const { id, method, args, type } = message;

    if (type === 'unsubscribe' && id) {
      activeSubscriptions.get(id)?.unsubscribe();
      activeSubscriptions.delete(id);
      return;
    }

    if (type !== 'call' || !method) return;

    const implementation = methods[method];
    if (!implementation) {
      post({
        type: 'error',
        id,
        error: {
          message: `Method '${method}' not found in UtilityProcess`,
          name: 'MethodNotFoundError',
        },
      });
      return;
    }

    try {
      const result: unknown = Reflect.apply(implementation, undefined, args ?? []);
      // Check if result is Observable

      if (result && typeof result === 'object' && 'subscribe' in result && typeof result.subscribe === 'function') {
        const subscriptionReference: { current?: Subscription } = {};
        const subscription = (result as Observable<unknown>).subscribe({
          next: (value: unknown) => {
            if (
              !postReply({
                type: 'stream',
                id,
                result: value,
              }, id)
            ) {
              subscriptionReference.current?.unsubscribe();
            }
          },
          error: (error: Error) => {
            if (id) activeSubscriptions.delete(id);
            postReply({
              type: 'error',
              id,
              error: {
                message: error.message,
                stack: error.stack,
                name: error.name,
              },
            }, id);
          },
          complete: () => {
            if (id) activeSubscriptions.delete(id);
            postReply({
              type: 'complete',
              id,
            }, id);
          },
        });
        subscriptionReference.current = subscription;
        if (id && !subscription.closed) {
          activeSubscriptions.set(id, subscription);
        }
      } else if (result && typeof result === 'object' && 'then' in result && typeof result.then === 'function') {
        // Handle Promise
        const resolvedValue = await (result as Promise<unknown>);
        postReply({
          type: 'response',
          id,
          result: resolvedValue,
        }, id);
      } else {
        // Handle synchronous result
        postReply({
          type: 'response',
          id,
          result,
        }, id);
      }
    } catch (error) {
      const error_ = error as Error;
      postReply({
        type: 'error',
        id,
        error: {
          message: error_ instanceof Error ? error_.message : String(error),
          stack: error_.stack,
          name: error_ instanceof Error ? error_.name : 'Error',
        },
      }, id);
    }
  });
}
