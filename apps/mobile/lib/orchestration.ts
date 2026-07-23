import {
  createFetchOrchestrationTransport,
  createRemoteOnlyHostCapabilities,
  createRemoteOrchestrationClient,
  OrchestrationError,
  type AgentOrchestrationClient,
} from '@memeloop/protocol';

export const MOBILE_ORCHESTRATION_CAPABILITIES = createRemoteOnlyHostCapabilities({
  resourceKinds: [
    'AgentDefinition',
    'AgentWorkload',
    'AgentRun',
    'LoopRun',
    'ToolOperation',
  ],
});

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
