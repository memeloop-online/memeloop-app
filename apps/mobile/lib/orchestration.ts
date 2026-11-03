import {
  createFetchOrchestrationTransport,
  createRemoteOrchestrationClient,
  OrchestrationError,
  type AgentOrchestrationCapabilities,
  type AgentOrchestrationClient,
} from 'memeloop/orchestration/portable';
import {
  createDeviceOrchestrationTransport,
  type DeviceNetworkService,
} from 'memeloop/device-network';

export const MOBILE_ORCHESTRATION_CAPABILITIES: AgentOrchestrationCapabilities = {
  operations: ['get', 'list', 'watch'],
  resourceKinds: [
    'AgentDefinition',
    'AgentWorkload',
    'AgentRun',
    'LoopRun',
    'ToolOperation',
  ],
  interfaces: ['resource'],
};

export interface MobileOrchestrationClientOptions {
  endpoint: string;
  /**
   * Resolve a short-lived access token from the host's secure credential
   * storage. Tokens must not be placed in Expo public environment variables.
   */
  getAccessToken: () => Promise<string | null>;
  fetch?: typeof globalThis.fetch;
}

/**
 * Mobile is a remote-only resource client. Scheduling, reconciliation, and
 * authoritative Agent state remain in the authenticated control-plane host.
 */
export function createMobileOrchestrationClient(
  options: MobileOrchestrationClientOptions,
): AgentOrchestrationClient {
  return createRemoteOrchestrationClient(
    createFetchOrchestrationTransport({
      endpoint: options.endpoint,
      fetch: options.fetch,
      headers: async () => {
        const accessToken = await options.getAccessToken();
        if (!accessToken) {
          throw new OrchestrationError({
            code: 'FORBIDDEN',
            message: 'Sign in before connecting to the MemeLoop control plane.',
            retryable: false,
          });
        }
        return { Authorization: `Bearer ${accessToken}` };
      },
    }),
  );
}

/** Connect to a mutually paired Desktop over the Noise-authenticated stream. */
export function createPairedDeviceOrchestrationClient(
  deviceNetwork: DeviceNetworkService,
  peerId: string,
): AgentOrchestrationClient {
  return createRemoteOrchestrationClient(
    createDeviceOrchestrationTransport({
      deviceNetwork,
      peerId,
    }),
  );
}
