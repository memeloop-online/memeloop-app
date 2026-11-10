import { describe, expect, it, vi } from 'vitest';

import { createDesktopRetryTurnHandler } from '../retryTurn';

describe('desktop durable retry bridge', () => {
  it('passes only durable identities to Core atomic retry', async () => {
    const retryTurn = vi.fn(async (_request: unknown) => ({
      handle: {
        runId: 'run-new',
        conversationId: 'conversation',
        turnId: 'turn-new',
        requestId: 'retry-request',
        state: 'accepted' as const,
      },
      tombstone: { kind: 'tombstone' },
      userEvent: { kind: 'message' },
    }));
    const handler = createDesktopRetryTurnHandler({ retryTurn } as never);

    await handler({
      conversationId: 'conversation',
      turnId: 'turn-old',
      newTurnId: 'turn-new',
      requestId: 'retry-request',
      definitionId: 'definition',
    }, 'authenticated-peer');

    expect(retryTurn).toHaveBeenCalledWith({
      conversationId: 'conversation',
      turnId: 'turn-old',
      newTurnId: 'turn-new',
      requestId: 'retry-request',
      definitionId: 'definition',
      requestPeerId: 'authenticated-peer',
    });
    expect(retryTurn.mock.calls[0]?.[0]).not.toHaveProperty('message');
    expect(retryTurn.mock.calls[0]?.[0]).not.toHaveProperty('userMessage');
  });
});
