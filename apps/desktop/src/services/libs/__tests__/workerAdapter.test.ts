import { EventEmitter } from 'node:events';
import type { Worker } from 'node:worker_threads';
import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { WorkerMessage } from '../workerAdapter';

class FakeWorker extends EventEmitter {
  public readonly postMessage = vi.fn<(message: WorkerMessage) => void>();
}

describe('createWorkerProxy', () => {
  it('uses the explicit observable method list instead of name heuristics', async () => {
    const { createWorkerProxy } = await vi.importActual<
      typeof import('../workerAdapter')
    >('../workerAdapter');
    const worker = new FakeWorker();
    const proxy = createWorkerProxy<{
      startServer(): Promise<{ running: boolean }>;
      subscribeLogs(): import('rxjs').Observable<string>;
      subscribeToUpdates(conversationId: string): import('rxjs').Observable<string>;
      subscribeConversationMutations(): import('rxjs').Observable<{ conversationIds: string[] }>;
    }>(worker as unknown as Worker, {
      observableMethods: ['subscribeLogs', 'subscribeToUpdates', 'subscribeConversationMutations'],
    });

    const startPromise = proxy.startServer();
    const startCall = worker.postMessage.mock.calls[0]?.[0];
    expect(startPromise).toBeInstanceOf(Promise);
    worker.emit(
      'message',
      {
        type: 'response',
        id: startCall?.id,
        result: { running: true },
      } satisfies WorkerMessage,
    );
    await expect(startPromise).resolves.toEqual({ running: true });

    const firstLog = firstValueFrom(proxy.subscribeLogs());
    const subscribeCall = worker.postMessage.mock.calls[1]?.[0];
    worker.emit(
      'message',
      {
        type: 'stream',
        id: subscribeCall?.id,
        result: 'ready',
      } satisfies WorkerMessage,
    );
    await expect(firstLog).resolves.toBe('ready');

    const updateSubscription = proxy.subscribeToUpdates('conversation-1').subscribe();
    const updateCall = worker.postMessage.mock.calls
      .map(([message]) => message)
      .find(message => message.type === 'call' && message.method === 'subscribeToUpdates');
    expect(updateCall).toMatchObject({
      type: 'call',
      method: 'subscribeToUpdates',
      args: ['conversation-1'],
    });

    updateSubscription.unsubscribe();
    expect(worker.postMessage.mock.calls.map(([message]) => message)).toContainEqual({
      type: 'unsubscribe',
      id: updateCall?.id,
    });

    const mutationSubscription = proxy.subscribeConversationMutations().subscribe();
    const mutationCall = worker.postMessage.mock.calls
      .map(([message]) => message)
      .find(message => message.type === 'call' && message.method === 'subscribeConversationMutations');
    expect(mutationCall).toMatchObject({
      type: 'call',
      method: 'subscribeConversationMutations',
      args: [],
    });
    mutationSubscription.unsubscribe();
    expect(worker.postMessage.mock.calls.map(([message]) => message)).toContainEqual({
      type: 'unsubscribe',
      id: mutationCall?.id,
    });
  });
});
