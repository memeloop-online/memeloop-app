import { type AgentRuntimeDeviceRpcHandlerOptions, createAgentRuntimeDeviceRpcHandler, type DeviceRpcHandler } from 'memeloop';

export interface DesktopDeviceRpcHandlers {
  /**
   * Used only across the main-process to UtilityProcess boundary. The caller
   * is not a network peer and cannot present a DeviceNetwork grant.
   */
  local: DeviceRpcHandler;
  /** Network-facing handler; Core continues to require a verified grant or host authorizer. */
  network: DeviceRpcHandler;
}

/**
 * Keep the local IPC exception separate from the handler handed to libp2p.
 * Making the latter trusted would allow an unauthenticated network caller to
 * bypass Core's RPC grant gate.
 */
export function createDesktopDeviceRpcHandlers(
  options: AgentRuntimeDeviceRpcHandlerOptions,
): DesktopDeviceRpcHandlers {
  return {
    local: createAgentRuntimeDeviceRpcHandler({
      ...options,
      trustedLocalOnly: true,
    }),
    network: createAgentRuntimeDeviceRpcHandler(options),
  };
}
