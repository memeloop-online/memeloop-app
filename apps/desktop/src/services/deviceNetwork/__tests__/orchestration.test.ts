import { REMOTE_ORCHESTRATION_PROTOCOL, type RemoteOrchestrationRequest } from 'memeloop';
import { Observable, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { createDesktopOrchestrationClient } from '../orchestration';

const capabilitiesRequest: RemoteOrchestrationRequest = {
  protocol: REMOTE_ORCHESTRATION_PROTOCOL,
  requestId: 'capabilities',
  operation: 'capabilities',
  payload: {},
};

describe('createDesktopOrchestrationClient', () => {
  it('adapts main-process requests without exposing worker credentials', async () => {
    const requestOrchestration = vi.fn(async (request) => ({
      protocol: REMOTE_ORCHESTRATION_PROTOCOL,
      requestId: request.requestId,
      ok: true as const,
      result: {
        operations: ['get', 'list', 'watch'],
        resourceKinds: ['AgentRun'],
        interfaces: ['resource'],
      },
    }));
    const client = createDesktopOrchestrationClient({
      requestOrchestration,
      subscribeToOrchestrationWatch: () => of(),
    });

    await expect(client.getCapabilities()).resolves.toMatchObject({
      resourceKinds: ['AgentRun'],
    });
    expect(requestOrchestration).toHaveBeenCalledWith(
      expect.objectContaining({ operation: capabilitiesRequest.operation }),
    );
  });

  it('unsubscribes the worker watch when the caller aborts', async () => {
    const unsubscribe = vi.fn();
    const abort = new AbortController();
    const client = createDesktopOrchestrationClient({
      requestOrchestration: vi.fn(),
      subscribeToOrchestrationWatch: () => new Observable(() => unsubscribe),
    });

    const iterator = (
      client.watch(
        { kind: 'AgentRun' },
        { signal: abort.signal },
      )
    )[Symbol.asyncIterator]();
    const pending = iterator.next();
    abort.abort();

    await expect(pending).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
