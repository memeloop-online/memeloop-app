import { EventEmitter } from 'node:events';
import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { WorkerMessage } from '../workerAdapter';

class FakeUtilityProcess extends EventEmitter {
  public readonly pid = 42;
  public readonly postMessage = vi.fn<(message: WorkerMessage) => void>();
  public readonly kill = vi.fn(() => true);
}

describe('createWorkerProxy', () => {
  it('uses the explicit observable method list instead of name heuristics', async () => {
    const { createWorkerProxy } = await vi.importActual<
      typeof import('../workerAdapter')
    >('../workerAdapter');
    const worker = new FakeUtilityProcess();
    const proxy = createWorkerProxy<{
      startServer(): Promise<{ running: boolean }>;
      subscribeLogs(): import('rxjs').Observable<string>;
      subscribeToUpdates(conversationId: string): import('rxjs').Observable<string>;
      subscribeConversationMutations(): import('rxjs').Observable<{ conversationIds: string[] }>;
    }>(worker, {
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

  it('unwraps UtilityProcess message events and rejects in-flight calls after a crash', async () => {
    const { createWorkerProxy } = await vi.importActual<
      typeof import('../workerAdapter')
    >('../workerAdapter');
    const utilityProcess = new FakeUtilityProcess();
    const proxy = createWorkerProxy<{ ping(): Promise<{ ok: boolean }> }>(
      utilityProcess,
    );

    const responsePromise = proxy.ping();
    const call = utilityProcess.postMessage.mock.calls[0]?.[0];
    utilityProcess.emit('message', {
      data: {
        type: 'response',
        id: call?.id,
        result: { ok: true },
      } satisfies WorkerMessage,
      ports: [],
    });
    await expect(responsePromise).resolves.toEqual({ ok: true });

    const pendingPromise = proxy.ping();
    utilityProcess.emit('exit', 139);
    await expect(pendingPromise).rejects.toThrow('UtilityProcess exited with code 139');
  });

  it('rejects oversized or cyclic calls before they reach the UtilityProcess', async () => {
    const { createWorkerProxy } = await vi.importActual<
      typeof import('../workerAdapter')
    >('../workerAdapter');
    const { assertWorkerIpcValue, WORKER_IPC_MAX_BYTES, WORKER_IPC_MAX_DEPTH } = await vi.importActual<
      typeof import('../workerAdapter')
    >('../workerAdapter');
    const worker = new FakeUtilityProcess();
    const proxy = createWorkerProxy<{ send(payload: string): Promise<void> }>(worker);
    const oversized = proxy.send('x'.repeat(WORKER_IPC_MAX_BYTES));
    await expect(oversized).rejects.toThrow('worker_ipc_message_too_large');
    expect(worker.postMessage).not.toHaveBeenCalled();

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => {
      assertWorkerIpcValue(cyclic);
    }).toThrow('worker_ipc_cyclic_value');

    let deep: unknown = 'leaf';
    for (let index = 0; index <= WORKER_IPC_MAX_DEPTH; index += 1) {
      deep = { next: deep };
    }
    expect(() => {
      assertWorkerIpcValue(deep);
    }).toThrow('worker_ipc_max_depth_exceeded');
  });

  it('contains postMessage failures at the transport boundary', async () => {
    // Keep this test independent from the global workerAdapter mock used by
    // AgentInstanceService tests.
    const { safePostMessage } = await vi.importActual<typeof import('../workerAdapter')>('../workerAdapter');
    const peer = {
      postMessage: vi.fn(() => {
        throw new Error('closed');
      }),
    };
    expect(safePostMessage(peer, { type: 'call', id: 'closed' })).toBe(false);
    expect(peer.postMessage).toHaveBeenCalledTimes(1);
  });
});
