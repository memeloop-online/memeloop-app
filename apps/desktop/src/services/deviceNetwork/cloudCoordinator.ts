import type { DeviceCapabilities, DeviceCloudConnectionAdapter, DeviceCloudConnectionCoordinatorOptions, LocalDeviceIdentity } from 'memeloop/device-network';
import { buildDeviceHeartbeatMessage, DeviceCloudConnectionCoordinator, hasValidDirectCloudDeviceAddress } from 'memeloop/device-network';

export type DesktopCloudConnectionAdapter<Configuration> = Omit<
  DeviceCloudConnectionAdapter<Configuration>,
  'relayRequiredForOnline'
>;

/** Desktop can remain online without a relay only when it advertises a truly public direct address. */
export function desktopRelayRequiredForOnline(multiaddrs: readonly string[]): boolean {
  return !hasValidDirectCloudDeviceAddress(multiaddrs);
}

/**
 * Bind the portable coordinator to Desktop's direct-address policy without
 * duplicating any lifecycle, retry, cancellation, or timer state in the host.
 */
export function createDesktopCloudConnectionCoordinator<Configuration>(
  options: Omit<DeviceCloudConnectionCoordinatorOptions<Configuration>, 'adapter'> & {
    adapter: DesktopCloudConnectionAdapter<Configuration>;
    getMultiaddrs: () => readonly string[];
  },
): DeviceCloudConnectionCoordinator<Configuration> {
  const { adapter, getMultiaddrs, ...coordinatorOptions } = options;
  return new DeviceCloudConnectionCoordinator({
    ...coordinatorOptions,
    adapter: {
      isConfigured: configuration => adapter.isConfigured(configuration),
      relayRequiredForOnline: () => desktopRelayRequiredForOnline(getMultiaddrs()),
      ensureAuthorizer: (configuration, signal) => adapter.ensureAuthorizer(configuration, signal),
      registerDevice: (configuration, signal) => adapter.registerDevice(configuration, signal),
      ensureRelay: (configuration, signal) => adapter.ensureRelay(configuration, signal),
      heartbeat: (configuration, signal) => adapter.heartbeat(configuration, signal),
      syncDirectory: (configuration, signal) => adapter.syncDirectory(configuration, signal),
      ...(adapter.dispose
        ? { dispose: (configuration: Configuration, signal: AbortSignal) => adapter.dispose!(configuration, signal) }
        : {}),
      ...(adapter.classifyError
        ? { classifyError: (error: unknown) => adapter.classifyError!(error) }
        : {}),
      ...(adapter.listBackgroundSyncPeerIds
        ? {
          listBackgroundSyncPeerIds: (configuration: Configuration, signal: AbortSignal) => adapter.listBackgroundSyncPeerIds!(configuration, signal),
        }
        : {}),
      ...(adapter.syncDevice
        ? {
          syncDevice: (configuration: Configuration, peerId: string, signal: AbortSignal) => adapter.syncDevice!(configuration, peerId, signal),
        }
        : {}),
    },
  });
}

export interface DesktopHeartbeatUnsigned {
  peerId: string;
  timestamp: number;
  capabilities: DeviceCapabilities;
  multiaddrs: string[];
  relayReservations: string[];
}

export type DesktopIdentityPayloadSigner = (input: {
  identity: LocalDeviceIdentity;
  payload: Uint8Array;
}) => Promise<string>;

/** Create the nonce-bound, domain-separated proof used by the shared Cloud adapter. */
export async function signDesktopCloudHeartbeat(input: {
  identity: LocalDeviceIdentity;
  message: DesktopHeartbeatUnsigned;
  signal: AbortSignal;
  nonce: string;
  signPayload: DesktopIdentityPayloadSigner;
}): Promise<{ nonce: string; signature: string }> {
  input.signal.throwIfAborted();
  const payload = buildDeviceHeartbeatMessage({ ...input.message, nonce: input.nonce });
  const signature = await input.signPayload({ identity: input.identity, payload });
  input.signal.throwIfAborted();
  return { nonce: input.nonce, signature };
}
