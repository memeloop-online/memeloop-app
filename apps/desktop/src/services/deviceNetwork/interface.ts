import { DeviceNetworkChannel } from '@/constants/channels';
import { ProxyPropertyType } from 'electron-ipc-cat/common';
import type {
  AgentOrchestrationClient,
  CloudDeviceRecord,
  Device,
  DeviceCapabilities,
  DeviceCloudConnectionSnapshot,
  DeviceConnectionGrant,
  DeviceNetworkService as CoreDeviceNetworkService,
  DeviceRpcHandler,
  FullAgentStorage,
  LocalDeviceIdentity,
  PairingSession,
  SyncResult,
} from 'memeloop';
import type { BehaviorSubject } from 'rxjs';

export interface DeviceNetworkRuntimeOptions {
  buildCapabilities?: () => Promise<DeviceCapabilities>;
  orchestrationClient?: AgentOrchestrationClient;
  rpcHandler?: DeviceRpcHandler;
  syncStorage?: FullAgentStorage;
}

/** Renderer-safe operation metadata; operation cancellation remains host-owned. */
export interface DeviceNetworkRpcOperationOptions {
  operationId: string;
  presentedGrant?: DeviceConnectionGrant;
}

export interface IDeviceNetworkService extends CoreDeviceNetworkService {
  getLocalIdentity(): Promise<LocalDeviceIdentity>;
  getPairingInvite(): Promise<string>;
  configureRuntime(options: DeviceNetworkRuntimeOptions): void;
  configureCloud(config?: { cloudUrl: string; accessToken: string }): Promise<void>;
  abortOperation(operationId: string): Promise<void>;
  finishOperation(operationId: string): Promise<void>;
  syncCloudDevices(): Promise<CloudDeviceRecord[]>;
  getCloudStatus(): DeviceCloudConnectionSnapshot;
  devices$: BehaviorSubject<Device[]>;
  pairingSessions$: BehaviorSubject<PairingSession[]>;
  cloudStatus$: BehaviorSubject<DeviceCloudConnectionSnapshot>;
  /** Exact IPC bridge for calls that participate in a host operation fence. */
  sendRpcForOperation(
    peerId: string,
    method: string,
    parameters: unknown,
    options: DeviceNetworkRpcOperationOptions,
  ): Promise<unknown>;
}

export const DeviceNetworkServiceIPCDescriptor = {
  channel: DeviceNetworkChannel.name,
  properties: {
    start: ProxyPropertyType.Function,
    stop: ProxyPropertyType.Function,
    getLocalDevice: ProxyPropertyType.Function,
    getLocalIdentity: ProxyPropertyType.Function,
    getPairingInvite: ProxyPropertyType.Function,
    listDevices: ProxyPropertyType.Function,
    listPairingSessions: ProxyPropertyType.Function,
    requestLocalPairing: ProxyPropertyType.Function,
    acceptPairing: ProxyPropertyType.Function,
    rejectPairing: ProxyPropertyType.Function,
    removeTrustedDevice: ProxyPropertyType.Function,
    configureCloud: ProxyPropertyType.Function,
    syncCloudDevices: ProxyPropertyType.Function,
    getCloudStatus: ProxyPropertyType.Function,
    sendRpc: ProxyPropertyType.Function,
    sendRpcForOperation: ProxyPropertyType.Function,
    abortOperation: ProxyPropertyType.Function,
    finishOperation: ProxyPropertyType.Function,
    syncWithDevice: ProxyPropertyType.Function,
    devices$: ProxyPropertyType.Value$,
    pairingSessions$: ProxyPropertyType.Value$,
    cloudStatus$: ProxyPropertyType.Value$,
  },
};

export type { CloudDeviceRecord, Device, PairingSession, SyncResult };
