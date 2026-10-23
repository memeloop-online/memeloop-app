/** Signal-bearing options positions in the canonical storage API. Payloads are never traversed. */
const signalOptionsIndex: Readonly<Record<string, number>> = {
  listConversationsPage: 1,
  getMessagePage: 2,
  getFullContentMessagePage: 2,
  getMessageWindowAround: 2,
  getConversationTimelinePage: 2,
  getMessageIdentity: 2,
  readMessageDetailRange: 4,
  getConversationEventPage: 1,
  getEventVersionFrontierPage: 0,
  getEventVersionFrontiersForKeys: 1,
  getCompactionCandidatePage: 2,
  getRetainedCompactionControls: 2,
  getConversationMeta: 1,
  getAttachment: 1,
  readAttachmentData: 1,
  readAttachmentRange: 3,
  stageAttachmentChunk: 3,
  commitStagedAttachment: 1,
  verifyAttachment: 1,
  conversationReferencesAttachment: 2,
};

export interface WorkerStorageRequest {
  requestId: string;
  method: string;
  arguments_: unknown[];
}

interface WorkerStorageProxy {
  storageCall(request: WorkerStorageRequest): Promise<unknown>;
  cancelStorageCall(requestId: string): Promise<void>;
}

/** Send only cloneable options; cancellation is a separate worker message. */
export async function callWorkerStorage(
  worker: WorkerStorageProxy,
  requestId: string,
  method: string,
  arguments_: unknown[],
): Promise<unknown> {
  const index = signalOptionsIndex[method];
  const options = index === undefined ? undefined : arguments_[index] as { signal?: AbortSignal } | undefined;
  const signal = options?.signal;
  signal?.throwIfAborted();
  const copiedArguments = [...arguments_];
  if (index !== undefined && options !== undefined) {
    const { signal: _signal, ...cloneableOptions } = options;
    copiedArguments[index] = cloneableOptions;
  }
  let cancel: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    cancel = () => {
      void worker.cancelStorageCall(requestId).catch(() => undefined);
      // AbortSignal permits arbitrary reasons; preserve the caller's cancellation.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      reject(signal.reason);
    };
    signal.addEventListener('abort', cancel, { once: true });
  });
  try {
    const result = await Promise.race([
      worker.storageCall({ requestId, method, arguments_: copiedArguments }),
      cancelled,
    ]);
    signal?.throwIfAborted();
    return result;
  } finally {
    if (cancel) signal?.removeEventListener('abort', cancel);
  }
}

/** Controllers stay in the UtilityProcess, including during runtime initialization. */
export function createWorkerStorageBridge(getStorage: () => Promise<object>) {
  const pending = new Map<string, AbortController>();
  return {
    async call(request: WorkerStorageRequest): Promise<unknown> {
      const controller = new AbortController();
      pending.set(request.requestId, controller);
      try {
        const storage = await getStorage();
        controller.signal.throwIfAborted();
        const callable: unknown = Reflect.get(storage, request.method);
        if (typeof callable !== 'function') throw new Error(`memeloop_storage_method_not_supported:${request.method}`);
        const arguments_ = [...request.arguments_];
        const index = signalOptionsIndex[request.method];
        if (index !== undefined) {
          arguments_[index] = { ...arguments_[index] as object | undefined, signal: controller.signal };
        }
        const result: unknown = await Reflect.apply(callable, storage, arguments_);
        controller.signal.throwIfAborted();
        return result;
      } finally {
        pending.delete(request.requestId);
      }
    },
    cancel(requestId: string): void {
      pending.get(requestId)?.abort(new Error('storage_request_cancelled'));
    },
    abortAll(): void {
      for (const controller of pending.values()) controller.abort(new Error('MemeLoop UtilityProcess is shutting down'));
      pending.clear();
    },
  };
}
