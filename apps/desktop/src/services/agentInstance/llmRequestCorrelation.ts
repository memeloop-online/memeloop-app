import { AsyncLocalStorage } from 'node:async_hooks';

import type { MemeLoopRuntime } from 'memeloop';

/**
 * Carries a conversation identity through the worker's asynchronous Core run
 * to the host LLM callback. A callback may expose only model messages, so
 * this is a correlation fallback rather than request metadata sent to a
 * provider.
 */
const llmConversationScope = new AsyncLocalStorage<string>();

export function runWithLlmConversation<T>(conversationId: string, operation: () => T): T {
  return llmConversationScope.run(conversationId, operation);
}

export function resolveLlmConversationId(request: { conversationId?: unknown }): string | undefined {
  return typeof request.conversationId === 'string' && request.conversationId.length > 0
    ? request.conversationId
    : llmConversationScope.getStore();
}

/**
 * Core schedules the accepted run asynchronously, so its callback can omit
 * `conversationId` even though the RPC request had one. Wrap only the runtime
 * entry points which start a model run; read/cancel operations stay unchanged.
 */
export function createLlmCorrelatedRuntime(
  runtime: Pick<MemeLoopRuntime, 'createAgent' | 'sendMessage' | 'getRunStatus' | 'cancelRun'>,
): Pick<MemeLoopRuntime, 'createAgent' | 'sendMessage' | 'getRunStatus' | 'cancelRun'> {
  return {
    createAgent: options =>
      options.conversationId === undefined
        ? runtime.createAgent(options)
        : runWithLlmConversation(options.conversationId, () => runtime.createAgent(options)),
    sendMessage: options =>
      runWithLlmConversation(
        options.conversationId,
        () => runtime.sendMessage(options),
      ),
    getRunStatus: runId => runtime.getRunStatus(runId),
    cancelRun: runId => runtime.cancelRun(runId),
  };
}
