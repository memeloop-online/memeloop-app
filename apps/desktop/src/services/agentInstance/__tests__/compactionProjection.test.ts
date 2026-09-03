import { type Observable, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AgentInstanceService } from '../index';

interface AgentInstanceServiceInternals {
  bindWorkerConversation(agentId: string, conversationId: string): void;
  memeLoopHostIdentity?: { peerId: string };
  memeLoopWorker: {
    subscribeToUpdates(conversationId: string): Observable<unknown>;
  };
  publishWorkerUpdate: ReturnType<typeof vi.fn>;
  workerActiveTurnIdByConversationId: Map<string, string>;
}

describe('AgentInstanceService compaction projection', () => {
  it('leaves compaction to the durable Core boundary without publishing an ordinary assistant message', () => {
    const updates = new Subject<unknown>();
    const publishWorkerUpdate = vi.fn().mockResolvedValue(undefined);
    const service = new AgentInstanceService();
    const internals = service as unknown as AgentInstanceServiceInternals;
    internals.memeLoopWorker = {
      subscribeToUpdates: () => updates.asObservable(),
    };
    internals.memeLoopHostIdentity = { peerId: '12D3KooWcanonicalProjectionPeer' };
    internals.workerActiveTurnIdByConversationId.set('conversation-1', 'turn-1');
    internals.publishWorkerUpdate = publishWorkerUpdate;
    internals.bindWorkerConversation('agent-1', 'conversation-1');

    updates.next({
      update: {
        type: 'agent-step',
        step: {
          type: 'thinking',
          data: {
            status: 'compacted',
            droppedCount: 8,
            summaryText: 'Earlier messages were compacted.',
          },
        },
      },
    });

    expect(publishWorkerUpdate).not.toHaveBeenCalled();

    updates.next({
      update: {
        type: 'agent-step',
        step: { type: 'message', data: 'Visible assistant output' },
      },
    });

    expect(publishWorkerUpdate).toHaveBeenCalledTimes(1);
    expect(publishWorkerUpdate).toHaveBeenCalledWith(
      'agent-1',
      'working',
      expect.objectContaining({
        role: 'assistant',
        content: 'Visible assistant output',
      }),
    );
  });
});
