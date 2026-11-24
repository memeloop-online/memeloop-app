import { describe, expect, it, vi } from 'vitest';
import { callWorkerStorage, createWorkerStorageBridge, type WorkerStorageRequest } from '../workerStorageBridge';

function cloneTransport(bridge: ReturnType<typeof createWorkerStorageBridge>) {
  return {
    storageCall: vi.fn(async (request: WorkerStorageRequest) => {
      const result = await bridge.call(structuredClone(request));
      return structuredClone(result);
    }),
    cancelStorageCall: vi.fn(async (requestId: string) => {
      bridge.cancel(structuredClone(requestId));
    }),
  };
}

describe('UtilityProcess storage cancellation', () => {
  it.each(
    [
      ['getEventVersionFrontierPage', [{ limit: 20 }], 0],
      ['getConversationEventPage', ['conversation', { limit: 20 }], 1],
      ['getMessagePage', ['conversation', { limit: 20 }, {}], 2],
      ['readAttachmentRange', ['hash', 0, 100, {}], 3],
    ] as const,
  )('recreates %s options after structured clone and cleans up completed calls', async (method, arguments_, index) => {
    let workerSignal!: AbortSignal;
    const storage = {
      value: new Uint8Array([1, 2, 3]),
      [method]: function(this: { value: Uint8Array }, ...args: unknown[]) {
        workerSignal = (args[index] as { signal: AbortSignal }).signal;
        workerSignal.throwIfAborted();
        return this.value;
      },
    };
    const bridge = createWorkerStorageBridge(async () => storage);
    const worker = cloneTransport(bridge);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const args: unknown[] = [...arguments_];
    args[index] = { ...args[index] as object, signal: controller.signal };
    const result = await callWorkerStorage(worker, 'read', method, args) as Uint8Array;
    expect(ArrayBuffer.isView(result)).toBe(true);
    expect(Array.from(result)).toEqual([1, 2, 3]);
    expect(workerSignal).not.toBe(controller.signal);
    expect(worker.storageCall.mock.calls[0][0].arguments_[index]).not.toHaveProperty('signal');
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    bridge.cancel('read');
    expect(workerSignal.aborted).toBe(false);
    controller.abort();
    expect(worker.cancelStorageCall).not.toHaveBeenCalled();
  });

  it('rejects cancellation promptly and aborts the active worker read', async () => {
    const started = Promise.withResolvers<undefined>();
    const bridge = createWorkerStorageBridge(async () => ({
      getAttachment: (_hash: string, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason as Error);
          }, { once: true });
          started.resolve(undefined);
        }),
    }));
    const worker = cloneTransport(bridge);
    const controller = new AbortController();
    const result = callWorkerStorage(worker, 'active', 'getAttachment', ['hash', { signal: controller.signal }]);
    await started.promise;
    const reason = new Error('caller stopped sync');
    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
    expect(worker.cancelStorageCall).toHaveBeenCalledExactlyOnceWith('active');
  });

  it('cancels during initialization without invoking storage and rejects pre-aborted calls before IPC', async () => {
    const initialized = Promise.withResolvers<object>();
    const storageRead = vi.fn();
    const bridge = createWorkerStorageBridge(() => initialized.promise);
    const worker = cloneTransport(bridge);
    const controller = new AbortController();
    const result = callWorkerStorage(worker, 'initializing', 'getAttachment', ['hash', { signal: controller.signal }]);
    controller.abort(new Error('cancel startup'));
    await expect(result).rejects.toThrow('cancel startup');
    initialized.resolve({ getAttachment: storageRead });
    await vi.waitFor(() => {
      expect(worker.storageCall.mock.settledResults[0]?.type).toBe('rejected');
    });
    expect(storageRead).not.toHaveBeenCalled();
    await expect(callWorkerStorage(worker, 'pre-aborted', 'getAttachment', ['hash', { signal: controller.signal }])).rejects.toThrow('cancel startup');
    expect(worker.storageCall).toHaveBeenCalledOnce();
  });

  it('aborts active storage work on shutdown and removes the main-process listener', async () => {
    const started = Promise.withResolvers<undefined>();
    const bridge = createWorkerStorageBridge(async () => ({
      getAttachment: (_hash: string, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason as Error);
          }, { once: true });
          started.resolve(undefined);
        }),
    }));
    const worker = cloneTransport(bridge);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const result = callWorkerStorage(worker, 'shutdown', 'getAttachment', ['hash', { signal: controller.signal }]);
    await started.promise;
    bridge.abortAll();
    await expect(result).rejects.toThrow('shutting down');
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('suppresses late results from a storage operation that does not observe cancellation', async () => {
    const started = Promise.withResolvers<undefined>();
    const completed = Promise.withResolvers<string>();
    const bridge = createWorkerStorageBridge(async () => ({
      getAttachment: () => {
        started.resolve(undefined);
        return completed.promise;
      },
    }));
    const worker = cloneTransport(bridge);
    const controller = new AbortController();
    const result = callWorkerStorage(worker, 'late', 'getAttachment', ['hash', { signal: controller.signal }]);
    await started.promise;
    controller.abort(new Error('cancelled before completion'));
    await expect(result).rejects.toThrow('cancelled before completion');
    completed.resolve('stale result');
    await vi.waitFor(() => {
      expect(worker.storageCall.mock.settledResults[0]?.type).toBe('rejected');
    });
  });
});
