import type { MemeLoopRuntime } from 'memeloop';
import { describe, expect, it } from 'vitest';

import { createLlmCorrelatedRuntime, resolveLlmConversationId, runWithLlmConversation } from '../llmRequestCorrelation';

describe('LLM request conversation correlation', () => {
  it('keeps concurrent callback chains attributed to their own conversations', async () => {
    let releaseFirst!: () => void;
    const firstMayContinue = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    let firstEntered!: () => void;
    const firstStarted = new Promise<void>(resolve => {
      firstEntered = resolve;
    });

    const first = runWithLlmConversation('conversation-a', async () => {
      await Promise.resolve();
      firstEntered();
      await firstMayContinue;
      return resolveLlmConversationId({});
    });
    await firstStarted;

    const second = runWithLlmConversation('conversation-b', async () => {
      await Promise.resolve();
      return resolveLlmConversationId({});
    });
    await expect(second).resolves.toBe('conversation-b');

    releaseFirst();
    await expect(first).resolves.toBe('conversation-a');
  });

  it('prefers request metadata and never guesses outside a scoped run', () => {
    expect(resolveLlmConversationId({ conversationId: 'request-conversation' })).toBe('request-conversation');
    expect(resolveLlmConversationId({})).toBeUndefined();
  });

  it('keeps concurrent device-RPC model callbacks attributed to their accepted conversations', async () => {
    const callbackConversations: Array<Promise<string | undefined>> = [];
    const runtime: Pick<MemeLoopRuntime, 'createAgent' | 'sendMessage' | 'getRunStatus' | 'cancelRun'> = {
      createAgent: async options => ({ conversationId: options.conversationId ?? 'generated-conversation' }),
      sendMessage: async options => {
        callbackConversations.push(
          Promise.resolve().then(async () => {
            await new Promise<void>(resolve => setTimeout(resolve, options.conversationId === 'conversation-a' ? 5 : 0));
            return resolveLlmConversationId({});
          }),
        );
        return {
          runId: `run-${options.conversationId}`,
          conversationId: options.conversationId,
          turnId: `turn-${options.conversationId}`,
          requestId: `request-${options.conversationId}`,
          state: 'accepted',
        };
      },
      getRunStatus: async () => undefined,
      cancelRun: async () => false,
    };
    const correlated = createLlmCorrelatedRuntime(runtime);

    await Promise.all([
      correlated.sendMessage({ conversationId: 'conversation-a', message: 'first' }),
      correlated.sendMessage({ conversationId: 'conversation-b', message: 'second' }),
    ]);

    await expect(Promise.all(callbackConversations)).resolves.toEqual(['conversation-a', 'conversation-b']);
  });
});
