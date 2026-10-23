import type { AgentRuntimeRpcAuthorizationRequest } from 'memeloop';
import { AsyncLocalStorage } from 'node:async_hooks';

/** Main validates pairing trust; only its private worker IPC can establish this scope. */
export const authenticatedPairedPeer = new AsyncLocalStorage<string | undefined>();

export function authorizeNetworkAgentRequest(request: AgentRuntimeRpcAuthorizationRequest): boolean {
  // Core additionally checks every presented grant's permission and resource scope.
  return request.presentedGrant !== undefined || authenticatedPairedPeer.getStore() === request.remotePeerId;
}
