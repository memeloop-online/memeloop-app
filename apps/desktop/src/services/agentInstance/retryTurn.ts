import type { AgentRuntimeDeviceRpcHandlerOptions, MemeLoopRuntime } from 'memeloop';

/**
 * Bind Core's awaitable atomic retry seam. The RPC request contributes only
 * durable identities; Core point-reads the original user root from SQLite.
 */
export function createDesktopRetryTurnHandler(
  runtime: Pick<MemeLoopRuntime, 'retryTurn'>,
): NonNullable<AgentRuntimeDeviceRpcHandlerOptions['retryTurn']> {
  return (request, requestPeerId) =>
    runtime.retryTurn({
      conversationId: request.conversationId,
      turnId: request.turnId,
      newTurnId: request.newTurnId,
      requestId: request.requestId,
      ...(request.definitionId === undefined ? {} : { definitionId: request.definitionId }),
      requestPeerId,
    });
}
