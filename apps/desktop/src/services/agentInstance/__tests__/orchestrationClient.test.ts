import { REMOTE_ORCHESTRATION_PROTOCOL, type RemoteOrchestrationRequest } from '@memeloop/protocol';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { createDesktopRendererOrchestrationClient } from '../orchestrationClient';

describe('desktop renderer orchestration client', () => {
  it('uses the policy-scoped IPC request and watch bridges', async () => {
    const requestOrchestration = vi.fn(async (request: RemoteOrchestrationRequest) => ({
      protocol: REMOTE_ORCHESTRATION_PROTOCOL,
      requestId: request.requestId,
      ok: true as const,
      result: {
        operations: ['get', 'list', 'watch'],
        resourceKinds: ['AgentRun'],
        interfaces: ['resource'],
      },
    }));
    const subscribeToOrchestrationWatch = vi.fn((request: RemoteOrchestrationRequest) =>
      of({
        protocol: REMOTE_ORCHESTRATION_PROTOCOL,
        requestId: request.requestId,
        ok: true as const,
        result: { type: 'BOOKMARK', resourceVersion: '7' },
      })
    );
    window.service = {
      ...window.service,
      agentInstance: {
        ...window.service.agentInstance,
        requestOrchestration,
      },
    };
    window.observables = {
      ...window.observables,
      agentInstance: {
        ...window.observables.agentInstance,
        subscribeToOrchestrationWatch,
      },
    };

    const client = createDesktopRendererOrchestrationClient();
    await expect(client.getCapabilities()).resolves.toMatchObject({
      resourceKinds: ['AgentRun'],
    });
    const events = [];
    for await (const event of client.watch({ kind: 'AgentRun' })) {
      events.push(event);
    }
    expect(events).toEqual([{ type: 'BOOKMARK', resourceVersion: '7' }]);
    expect(requestOrchestration).toHaveBeenCalledOnce();
    expect(subscribeToOrchestrationWatch).toHaveBeenCalledOnce();
  });
});
