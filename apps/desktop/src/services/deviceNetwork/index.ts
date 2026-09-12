import { randomUUID } from 'node:crypto';

import { app } from 'electron';
import settings from 'electron-settings';
import { injectable } from 'inversify';
import { BehaviorSubject } from 'rxjs';

import {
  CloudDeviceAuthorizer,
  createDeviceIdentity,
  createSignedDevicePairingInvite,
  Libp2pDeviceNetworkService,
  type RawSeedDeviceIdentity,
  signDeviceBinding,
  signDeviceIdentityPayload,
} from '@memeloop/libp2p';
import {
  type CloudDeviceClient,
  CloudDeviceFetchClient,
  type CloudDeviceRecord,
  cloudRecordToDevice,
  createDeviceOrchestrationStreamHandler,
  createReadOnlyOrchestrationClient,
  createRemoteOrchestrationHandler,
  type Device,
  type DeviceCapabilities,
  type DeviceCloudCommitFence,
  type DeviceCloudConnectionCoordinator,
  type DeviceCloudConnectionSnapshot,
  type DeviceConnectionGrant,
  type DeviceConnectionGrantStringScope,
  type DeviceTrustStore,
  encodeDevicePairingInvite,
  type LocalDeviceIdentity,
  type LocalPairingRequestOptions,
  LocalTrustDeviceAuthorizer,
  type MemeLoopDuplexStream,
  type MemeLoopProtocol,
  MutableDeviceAuthorizer,
  type PairingSession,
  StandardDeviceCloudConnectionAdapter,
  type SyncResult,
  type TrustedDeviceRecord,
} from 'memeloop';

import { getLocalAuthStore } from '@services/libs/authFileStore';
import { logger } from '@services/libs/log';

import { createDesktopCloudConnectionCoordinator, signDesktopCloudHeartbeat } from './cloudCoordinator';
import type { DeviceNetworkRpcOperationOptions, DeviceNetworkRuntimeOptions, IDeviceNetworkService } from './interface';

const DEVICE_IDENTITY_KEY = 'deviceNetwork.identity.v1';
const TRUSTED_DEVICES_KEY = 'deviceNetwork.trustedDevices.v2';
const CLOUD_CONFIGURATION_KEY = 'deviceNetwork.cloudConfiguration.v1';
const CLOUD_ACCESS_TOKEN_AUTH_KEY = 'deviceNetwork.cloud.accessToken.v1';
const IDENTITY_PRIVATE_KEY_AUTH_KEY = 'deviceNetwork.identity.privateKeyRawSeed.v1';
const CLOUD_HEARTBEAT_INTERVAL_MS = 60_000;
const RELAY_TOKEN_SAFETY_MARGIN_MS = 2 * 60_000;
const MOBILE_READ_ONLY_RESOURCE_KINDS = [
  'AgentDefinition',
  'AgentWorkload',
  'AgentRun',
  'LoopRun',
  'ToolOperation',
] as const;

interface StoredIdentityRecord {
  peerId: string;
  publicKeyMultibase: string;
  deviceName: string;
  platform: 'desktop';
  createdAt: number;
}

interface TrustedDeviceStoreEnvelope {
  epoch: string;
  generation: number;
  records: TrustedDeviceRecord[];
}

interface StoredCloudConfigurationRecord {
  cloudUrl: string;
}

interface DesktopCloudConfiguration {
  cloudUrl: string;
  accessToken: string;
  client: CloudDeviceFetchClient;
}

type ElectronSettingsValue = Parameters<typeof settings.setSync>[1];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toElectronSettingsValue(value: unknown): ElectronSettingsValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  if (Array.isArray(value)) return value.map(toElectronSettingsValue);
  if (isRecord(value)) {
    const object: Record<string, ElectronSettingsValue> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (nestedValue !== undefined) object[key] = toElectronSettingsValue(nestedValue);
    }
    return object;
  }
  throw new TypeError(`Unsupported settings value type: ${typeof value}`);
}

type DesktopDeviceSyncOptions = {
  presentedGrant?: DeviceConnectionGrant;
  conversationIds?: string[];
  signal?: AbortSignal;
  /** Serializable renderer-to-main cancellation handle. */
  operationId?: string;
};

type DesktopDeviceRequestOptions = {
  presentedGrant?: DeviceConnectionGrant;
  signal?: AbortSignal;
  /** Serializable renderer-to-main cancellation handle. */
  operationId?: string;
};

type ConnectionGrantScope = {
  protocols: MemeLoopProtocol[];
  rpcMethodScope: DeviceConnectionGrantStringScope;
  conversationScope: DeviceConnectionGrantStringScope;
  definitionScope: DeviceConnectionGrantStringScope;
};

function stringScope(value: unknown): DeviceConnectionGrantStringScope {
  return typeof value === 'string' && value.length > 0
    ? { mode: 'ids', ids: [value] }
    : { mode: 'none' };
}

function stringListScope(values: readonly string[] | undefined): DeviceConnectionGrantStringScope {
  if (values === undefined) return { mode: 'all' };
  const ids = [...new Set(values.filter(value => value.length > 0))].sort();
  return ids.length > 0 ? { mode: 'ids', ids } : { mode: 'none' };
}

function locallyPairedRecord(record: TrustedDeviceRecord | undefined): TrustedDeviceRecord | undefined {
  return record?.trustMode === 'local-pairing' ? record : undefined;
}

function isDeviceSyncOptions(value: DeviceConnectionGrant | DesktopDeviceSyncOptions | undefined): value is DesktopDeviceSyncOptions {
  return Boolean(value && ('presentedGrant' in value || 'conversationIds' in value || 'signal' in value || 'operationId' in value));
}

function isDeviceRequestOptions(value: DeviceConnectionGrant | DesktopDeviceRequestOptions | undefined): value is DesktopDeviceRequestOptions {
  return Boolean(value && ('presentedGrant' in value || 'signal' in value || 'operationId' in value));
}

function isTrustedDeviceRecord(value: unknown): value is TrustedDeviceRecord {
  if (!isRecord(value)) return false;
  const record = value;
  return typeof record.peerId === 'string' &&
    typeof record.publicKeyMultibase === 'string' &&
    typeof record.deviceName === 'string' &&
    typeof record.platform === 'string' &&
    typeof record.trustMode === 'string' &&
    typeof record.createdAt === 'number';
}

function parseTrustedDeviceRecords(value: unknown): TrustedDeviceRecord[] {
  if (!Array.isArray(value)) return [];
  const records: TrustedDeviceRecord[] = [];
  for (const candidate of value) {
    if (isTrustedDeviceRecord(candidate)) records.push(candidate);
  }
  return records;
}

function isStoredIdentityRecord(value: unknown): value is StoredIdentityRecord {
  if (!isRecord(value)) return false;
  return typeof value.peerId === 'string' &&
    typeof value.publicKeyMultibase === 'string' &&
    typeof value.deviceName === 'string' &&
    value.platform === 'desktop' &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt);
}

function isStoredCloudConfigurationRecord(value: unknown): value is StoredCloudConfigurationRecord {
  return isRecord(value) && typeof value.cloudUrl === 'string';
}

class ElectronSettingsDeviceTrustStore implements DeviceTrustStore {
  private readonly epoch = randomUUID();
  private mutationQueue: Promise<void> = Promise.resolve();

  public async loadTrustedDevices(): Promise<TrustedDeviceRecord[]> {
    await this.mutationQueue;
    return this.loadEnvelope().records.map(record => ({ ...record }));
  }

  public async saveTrustedDevice(record: TrustedDeviceRecord): Promise<void> {
    await this.mutate(() => {
      const current = this.loadEnvelope();
      const records = current.records.filter(candidate => candidate.peerId !== record.peerId);
      records.push({ ...record });
      this.saveEnvelope({ ...current, records: this.sort(records) });
    });
  }

  public async removeTrustedDevice(peerId: string): Promise<void> {
    await this.mutate(() => {
      const current = this.loadEnvelope();
      this.saveEnvelope({
        ...current,
        records: current.records.filter(record => record.peerId !== peerId),
      });
    });
  }

  /** Atomically replace Cloud-account trust while preserving explicit local pairing. */
  public async commitCloudAccountSnapshot(
    records: readonly TrustedDeviceRecord[],
    fence: DeviceCloudCommitFence,
  ): Promise<readonly TrustedDeviceRecord[] | undefined> {
    const peerIds = new Set<string>();
    for (const record of records) {
      if (record.trustMode !== 'cloud-account' || peerIds.has(record.peerId)) {
        throw new TypeError('invalid_cloud_account_trust_snapshot');
      }
      peerIds.add(record.peerId);
    }
    let committed: TrustedDeviceRecord[] | undefined;
    await this.mutate(() => {
      fence.throwIfStale();
      const current = this.loadEnvelope();
      if (current.epoch === this.epoch && current.generation > fence.generation) return;
      const nextByPeerId = new Map(
        current.records
          .filter(record => record.trustMode !== 'cloud-account')
          .map(record => [record.peerId, record]),
      );
      for (const record of records) {
        if (nextByPeerId.get(record.peerId)?.trustMode === 'local-pairing') continue;
        nextByPeerId.set(record.peerId, { ...record });
      }
      const next = this.sort([...nextByPeerId.values()]);
      const didCommit = fence.commitSynchronous(() => {
        this.saveEnvelope({ epoch: this.epoch, generation: fence.generation, records: next });
      });
      if (didCommit) committed = next;
    });
    return committed;
  }

  private loadEnvelope(): TrustedDeviceStoreEnvelope {
    const stored = settings.getSync(TRUSTED_DEVICES_KEY);
    if (!isRecord(stored)) {
      return { epoch: this.epoch, generation: 0, records: [] };
    }
    return {
      epoch: typeof stored.epoch === 'string' ? stored.epoch : this.epoch,
      generation: typeof stored.generation === 'number' && Number.isSafeInteger(stored.generation)
        ? stored.generation
        : 0,
      records: parseTrustedDeviceRecords(stored.records),
    };
  }

  private saveEnvelope(envelope: TrustedDeviceStoreEnvelope): void {
    settings.setSync(TRUSTED_DEVICES_KEY, toElectronSettingsValue(envelope));
  }

  private sort(records: TrustedDeviceRecord[]): TrustedDeviceRecord[] {
    return records.sort((left, right) => left.peerId.localeCompare(right.peerId));
  }

  private async mutate(operation: () => void | Promise<void>): Promise<void> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    await result;
  }
}

const emptyCapabilities: DeviceCapabilities = {
  tools: [],
  mcpServers: [],
  hasWiki: false,
  agentLoop: false,
  imChannels: [],
  wikis: [],
};

@injectable()
export class DeviceNetworkService implements IDeviceNetworkService {
  private core?: Libp2pDeviceNetworkService;
  private readonly activeOperations = new Map<string, AbortController>();
  private identity?: RawSeedDeviceIdentity;
  private started = false;
  private readonly trustStore = new ElectronSettingsDeviceTrustStore();
  private cloudConfig?: DesktopCloudConfiguration;
  private cloudCoordinator?: DeviceCloudConnectionCoordinator<CloudDeviceClient>;
  private standardCloudAdapter?: StandardDeviceCloudConnectionAdapter;
  private mutableAuthorizer?: MutableDeviceAuthorizer;
  private cloudGrantCache = new Map<string, DeviceConnectionGrant>();
  private lastCloudDevices: CloudDeviceRecord[] = [];
  private currentCapabilities: DeviceCapabilities = emptyCapabilities;
  private cloudStatus: DeviceCloudConnectionSnapshot = {
    status: 'not-configured',
    generation: 0,
    components: {
      authorizer: 'not-run',
      registration: 'not-run',
      relay: 'not-run',
      heartbeat: 'not-run',
      directory: 'not-run',
    },
  };
  private runtimeOptions: DeviceNetworkRuntimeOptions = {};
  public devices$ = new BehaviorSubject<Device[]>([]);
  public pairingSessions$ = new BehaviorSubject<PairingSession[]>([]);
  public cloudStatus$ = new BehaviorSubject<DeviceCloudConnectionSnapshot>(this.cloudStatus);
  private deviceNetworkUnsubscribers: Array<() => void> = [];

  public configureRuntime(options: DeviceNetworkRuntimeOptions): void {
    this.runtimeOptions = options;
    if (this.started) {
      void this.refreshCapabilities().then(() => this.cloudCoordinator?.runNow()).catch((error: unknown) => {
        logger.warn('DeviceNetworkService capability refresh failed', { error });
      });
    }
  }

  public async getLocalIdentity(): Promise<LocalDeviceIdentity> {
    await this.ensureIdentity();
    return this.identity!;
  }

  public async start(): Promise<void> {
    if (this.started) return;
    this.loadPersistedCloudConfiguration();
    await this.ensureIdentity();
    await this.refreshCapabilities();
    this.mutableAuthorizer = new MutableDeviceAuthorizer(this.createLocalPairingAuthorizer());
    const orchestrationClient = this.runtimeOptions.orchestrationClient;
    this.core = new Libp2pDeviceNetworkService({
      identity: this.identity!,
      capabilities: this.currentCapabilities,
      trustStore: this.trustStore,
      authorizer: this.mutableAuthorizer,
      enableMdns: true,
      syncStorage: this.runtimeOptions.syncStorage,
      rpcHandler: this.runtimeOptions.rpcHandler,
      orchestrationHandler: orchestrationClient
        ? createDeviceOrchestrationStreamHandler({
          resolveHandler: () =>
            createRemoteOrchestrationHandler(
              createReadOnlyOrchestrationClient(orchestrationClient, {
                allowedResourceKinds: MOBILE_READ_ONLY_RESOURCE_KINDS,
              }),
            ),
        })
        : undefined,
    });
    await this.core.start();
    this.started = true;
    // Wire core observables to IPC-serializable BehaviorSubjects.
    // The core's observe methods return unsubscribe functions that cannot cross IPC,
    // so we mirror their values into Value$ observables exposed to the renderer.
    this.deviceNetworkUnsubscribers.push(
      this.core.observeDevices((devices) => {
        this.devices$.next(devices);
      }),
      this.core.observePairingSessions((sessions) => {
        this.pairingSessions$.next(sessions);
      }),
    );
    this.ensureCloudCoordinator();
    await this.cloudCoordinator!.setConfiguration(this.cloudConfig?.client);
    await this.cloudCoordinator!.start().catch((error: unknown) => {
      logger.warn('DeviceNetworkService initial Cloud connection failed; recovery remains scheduled', { error });
    });
    logger.info('DeviceNetworkService started', { peerId: this.identity!.peerId, cloud: !!this.cloudConfig });
  }

  public async stop(): Promise<void> {
    if (!this.started) return;
    await this.cloudCoordinator?.stop();
    for (const unsubscribe of this.deviceNetworkUnsubscribers) {
      unsubscribe();
    }
    this.deviceNetworkUnsubscribers = [];
    await this.core?.stop();
    this.core = undefined;
    this.mutableAuthorizer = undefined;
    this.started = false;
    this.cloudGrantCache.clear();
    this.lastCloudDevices = [];
    logger.info('DeviceNetworkService stopped');
  }

  public async configureCloud(config?: { cloudUrl: string; accessToken: string }): Promise<void> {
    const next = config ? this.createCloudConfiguration(config) : undefined;
    this.persistCloudConfiguration(next);
    this.cloudConfig = next;
    this.cloudGrantCache.clear();
    this.lastCloudDevices = [];
    if (this.cloudCoordinator) await this.cloudCoordinator.setConfiguration(next?.client);
  }

  public async syncCloudDevices(): Promise<CloudDeviceRecord[]> {
    if (!this.cloudConfig || !this.cloudCoordinator) throw new Error('cloud_not_configured');
    await this.refreshCapabilities();
    await this.cloudCoordinator.runNow();
    return this.lastCloudDevices.map(device => ({ ...device }));
  }

  public async getLocalDevice(): Promise<Device> {
    return this.core!.getLocalDevice();
  }

  public async getPairingInvite(): Promise<string> {
    const localDevice = await this.getLocalDevice();
    await this.ensureIdentity();
    const invite = await createSignedDevicePairingInvite({
      identity: this.identity!,
      multiaddrs: localDevice.multiaddrs ?? [],
    });
    return encodeDevicePairingInvite(invite);
  }

  public async listDevices(): Promise<Device[]> {
    return this.core!.listDevices();
  }

  public observeDevices(listener: (devices: Device[]) => void): () => void {
    return this.core!.observeDevices(listener);
  }

  public async listPairingSessions(): Promise<PairingSession[]> {
    return this.core!.listPairingSessions();
  }

  public observePairingSessions(listener: (sessions: PairingSession[]) => void): () => void {
    return this.core!.observePairingSessions(listener);
  }

  public async requestLocalPairing(peerId: string, options?: LocalPairingRequestOptions): Promise<PairingSession> {
    return this.core!.requestLocalPairing(peerId, options);
  }

  public async acceptPairing(sessionId: string): Promise<void> {
    return this.core!.acceptPairing(sessionId);
  }

  public async rejectPairing(sessionId: string): Promise<void> {
    return this.core!.rejectPairing(sessionId);
  }

  public async removeTrustedDevice(peerId: string): Promise<void> {
    return this.core!.removeTrustedDevice(peerId);
  }

  public async openStream(
    peerId: string,
    protocol: MemeLoopProtocol,
    optionsOrGrant?: DeviceConnectionGrant | DesktopDeviceRequestOptions,
  ): Promise<MemeLoopDuplexStream> {
    const requestOptions = isDeviceRequestOptions(optionsOrGrant) ? optionsOrGrant : {};
    const operationController = requestOptions.operationId
      ? this.getOperationController(requestOptions.operationId)
      : undefined;
    const signal = requestOptions.signal && operationController
      ? AbortSignal.any([requestOptions.signal, operationController.signal])
      : requestOptions.signal ?? operationController?.signal;
    const suppliedGrant = isDeviceRequestOptions(optionsOrGrant) ? optionsOrGrant.presentedGrant : optionsOrGrant;
    const grant = suppliedGrant ?? await this.resolveOutboundGrant(peerId, {
      protocols: [protocol],
      rpcMethodScope: { mode: 'none' },
      conversationScope: { mode: 'none' },
      definitionScope: { mode: 'none' },
    }, signal);
    const { operationId: _operationId, ...coreOptions } = requestOptions;
    return this.core!.openStream(peerId, protocol, {
      ...coreOptions,
      signal,
      presentedGrant: grant,
    });
  }

  public async sendRpc<T>(
    peerId: string,
    method: string,
    parameters: unknown,
    optionsOrGrant?: DeviceConnectionGrant | DesktopDeviceRequestOptions,
  ): Promise<T> {
    const requestOptions = isDeviceRequestOptions(optionsOrGrant) ? optionsOrGrant : {};
    const operationController = requestOptions.operationId
      ? this.getOperationController(requestOptions.operationId)
      : undefined;
    const signal = requestOptions.signal && operationController
      ? AbortSignal.any([requestOptions.signal, operationController.signal])
      : requestOptions.signal ?? operationController?.signal;
    const suppliedGrant = isDeviceRequestOptions(optionsOrGrant) ? optionsOrGrant.presentedGrant : optionsOrGrant;
    const rpcParameters = isRecord(parameters) ? parameters : {};
    const conversationId = typeof rpcParameters.conversationId === 'string' ? rpcParameters.conversationId : undefined;
    const definitionId = typeof rpcParameters.definitionId === 'string' ? rpcParameters.definitionId : undefined;
    signal?.throwIfAborted();
    const grant = suppliedGrant ?? await this.resolveOutboundGrant(peerId, {
      protocols: ['/memeloop/rpc/2.0.0'],
      rpcMethodScope: { mode: 'ids', ids: [method] },
      conversationScope: stringScope(conversationId),
      definitionScope: stringScope(definitionId),
    }, signal);
    signal?.throwIfAborted();
    const { operationId: _operationId, ...coreOptions } = requestOptions;
    return this.core!.sendRpc(peerId, method, parameters, {
      ...coreOptions,
      signal,
      presentedGrant: grant,
    });
  }

  /**
   * Renderer-facing RPC entry point with an explicit operation fence. The
   * operation id is consumed by this host adapter and never enters Core's
   * portable DeviceNetworkService contract.
   */
  public sendRpcForOperation(
    peerId: string,
    method: string,
    parameters: unknown,
    options: DeviceNetworkRpcOperationOptions,
  ): Promise<unknown> {
    return this.sendRpc(peerId, method, parameters, options);
  }

  public async abortOperation(operationId: string): Promise<void> {
    this.activeOperations.get(operationId)?.abort(new Error('device_operation_cancelled'));
  }

  public async finishOperation(operationId: string): Promise<void> {
    this.activeOperations.delete(operationId);
  }

  private getOperationController(operationId: string): AbortController {
    if (!operationId || operationId.length > 256) throw new Error('invalid_device_operation_id');
    const existing = this.activeOperations.get(operationId);
    if (existing) return existing;
    const controller = new AbortController();
    this.activeOperations.set(operationId, controller);
    return controller;
  }

  public async syncWithDevice(
    peerId: string,
    optionsOrGrant?: DeviceConnectionGrant | DesktopDeviceSyncOptions,
  ): Promise<SyncResult> {
    const requestedOptions = isDeviceSyncOptions(optionsOrGrant) ? optionsOrGrant : {};
    const operationController = requestedOptions.operationId
      ? this.getOperationController(requestedOptions.operationId)
      : undefined;
    const signal = requestedOptions.signal && operationController
      ? AbortSignal.any([requestedOptions.signal, operationController.signal])
      : requestedOptions.signal ?? operationController?.signal;
    const suppliedGrant = isDeviceSyncOptions(optionsOrGrant) ? optionsOrGrant.presentedGrant : optionsOrGrant;
    const grant = suppliedGrant ?? await this.resolveOutboundGrant(peerId, {
      protocols: ['/memeloop/sync/2.0.0'],
      rpcMethodScope: { mode: 'none' },
      conversationScope: stringListScope(requestedOptions.conversationIds),
      definitionScope: { mode: 'none' },
    }, signal);
    const { operationId: _operationId, ...coreOptions } = requestedOptions;
    return this.core!.syncWithDevice(peerId, {
      ...coreOptions,
      signal,
      presentedGrant: grant,
    });
  }

  public getCloudStatus(): DeviceCloudConnectionSnapshot {
    return {
      ...this.cloudStatus,
      components: { ...this.cloudStatus.components },
      ...(this.cloudStatus.lastError ? { lastError: { ...this.cloudStatus.lastError } } : {}),
    };
  }

  private ensureCloudCoordinator(): void {
    if (this.cloudCoordinator) return;
    if (!this.identity || !this.core || !this.mutableAuthorizer) {
      throw new Error('device_network_not_started');
    }
    this.standardCloudAdapter = this.createStandardCloudAdapter();
    this.cloudCoordinator = createDesktopCloudConnectionCoordinator({
      adapter: this.standardCloudAdapter,
      getMultiaddrs: () => this.core?.getMultiaddrs() ?? [],
      heartbeatIntervalMs: CLOUD_HEARTBEAT_INTERVAL_MS,
      logWarning: (message, error) => {
        logger.warn(`DeviceNetworkService ${message}`, { error });
      },
      onStatus: (snapshot, fence) => {
        fence.commitSynchronous(() => {
          this.cloudStatus = {
            ...snapshot,
            components: { ...snapshot.components },
            ...(snapshot.lastError ? { lastError: { ...snapshot.lastError } } : {}),
          };
          this.cloudStatus$.next(this.getCloudStatus());
        });
      },
    });
  }

  private createStandardCloudAdapter(): StandardDeviceCloudConnectionAdapter {
    if (!this.identity || !this.core || !this.mutableAuthorizer) {
      throw new Error('device_network_not_started');
    }
    return new StandardDeviceCloudConnectionAdapter({
      capabilities: () => this.currentCapabilities,
      configureConnectionGrantPublicKey: async (publicKey, signal, fence) => {
        signal.throwIfAborted();
        fence.throwIfStale();
        const cloudAuthorizer = new CloudDeviceAuthorizer({
          localPeerId: this.identity!.peerId,
          grantVerificationPublicKeyMultibase: publicKey.publicKeyMultibase,
          getTrustedDevice: peerId => locallyPairedRecord(this.core?.getTrustedDevice(peerId)),
        });
        if (!this.mutableAuthorizer!.setDelegate(cloudAuthorizer, fence)) fence.throwIfStale();
      },
      clearConnectionGrantPublicKey: async signal => {
        this.mutableAuthorizer?.resetDelegate(signal);
      },
      clearTokenCache: async (client, signal) => {
        signal.throwIfAborted();
        if (client instanceof CloudDeviceFetchClient) await client.clearCachedTokens(signal);
        signal.throwIfAborted();
        this.cloudGrantCache.clear();
        this.lastCloudDevices = [];
      },
      commitCloudDirectorySnapshot: async (input, fence) => {
        await this.applyCloudDirectorySnapshot(
          [...input.cloudDevices],
          input.now,
          input.freshnessMs,
          fence,
        );
      },
      identity: this.identity,
      liveDirectory: {
        listCloudDeviceAddressPeerIds: () => this.core?.listCloudDeviceAddressPeerIds() ?? [],
        setCloudDeviceAddresses: (peerId, multiaddrs) => this.core?.setCloudDeviceAddresses(peerId, multiaddrs),
        removeCloudDeviceAddresses: peerId => this.core?.removeCloudDeviceAddresses(peerId),
        upsertCloudDiscoveredDevice: device => this.core?.upsertCloudDiscoveredDevice(device),
        removeCloudDiscoveredDevice: peerId => this.core?.removeCloudDiscoveredDevice(peerId),
        upsertCloudTrustedDevice: record => this.core?.upsertCloudTrustedDevice(record),
        removeCloudTrustedDevice: async peerId => this.core?.removeCloudTrustedDevice(peerId),
      },
      network: {
        getMultiaddrs: () => this.core?.getMultiaddrs() ?? [],
        configureRelayReservation: async (token, signal, fence) => {
          if (!this.core) throw new Error('device_network_not_started');
          await this.core.configureRelayReservation(token, signal, fence);
        },
        clearRelayReservation: async signal => {
          await this.core?.clearRelayReservation(signal);
        },
      },
      relayTokenSafetyMarginMs: RELAY_TOKEN_SAFETY_MARGIN_MS,
      signDeviceBinding: async ({ accountId, identity, nonce, signal }) => {
        signal.throwIfAborted();
        const signature = await signDeviceBinding({
          identity,
          accountId,
          nonce,
        });
        signal.throwIfAborted();
        return signature;
      },
      signHeartbeat: async ({ signal, ...message }) =>
        await signDesktopCloudHeartbeat({
          identity: this.identity!,
          message,
          signal,
          nonce: randomUUID(),
          signPayload: signDeviceIdentityPayload,
        }),
      trustStore: this.trustStore,
    });
  }

  private async applyCloudDirectorySnapshot(
    cloudDevices: CloudDeviceRecord[],
    now: number,
    freshnessMs: number | undefined,
    fence: DeviceCloudCommitFence,
  ): Promise<void> {
    const { signal } = fence;
    signal.throwIfAborted();
    fence.throwIfStale();
    if (!this.core || !this.identity) throw new Error('device_network_not_started');
    const remoteDevices = cloudDevices.filter(device => device.peerId !== this.identity!.peerId);
    const storedRecords = await this.trustStore.loadTrustedDevices();
    signal.throwIfAborted();
    fence.throwIfStale();
    const existingByPeerId = new Map(storedRecords.map(record => [record.peerId, record]));
    const seenPeerIds = new Set<string>();
    const cloudAccountSnapshot: TrustedDeviceRecord[] = [];
    for (const device of remoteDevices) {
      if (seenPeerIds.has(device.peerId)) throw new Error('cloud_directory_duplicate_peer');
      seenPeerIds.add(device.peerId);
      if (device.revokedAt || existingByPeerId.get(device.peerId)?.trustMode === 'local-pairing') continue;
      cloudAccountSnapshot.push({
        peerId: device.peerId,
        publicKeyMultibase: device.publicKeyMultibase,
        deviceName: device.deviceName,
        platform: device.platform,
        trustMode: 'cloud-account',
        accountId: device.accountId,
        createdAt: existingByPeerId.get(device.peerId)?.createdAt ?? now,
        lastSeen: device.lastSeen,
      });
    }
    const committedRecords = await this.trustStore.commitCloudAccountSnapshot(cloudAccountSnapshot, fence);
    if (!committedRecords) {
      fence.throwIfStale();
      throw new Error('cloud_directory_commit_rejected');
    }
    signal.throwIfAborted();
    fence.throwIfStale();
    const committedByPeerId = new Map(committedRecords.map(record => [record.peerId, record]));
    const activePeerIds = new Set(remoteDevices.filter(device => !device.revokedAt).map(device => device.peerId));
    const peerIdsToRemove = new Set([
      ...storedRecords
        .filter(record => record.trustMode === 'cloud-account' && !activePeerIds.has(record.peerId))
        .map(record => record.peerId),
      ...this.core.listCloudDeviceAddressPeerIds().filter(peerId => !activePeerIds.has(peerId)),
    ]);
    for (const peerId of peerIdsToRemove) {
      signal.throwIfAborted();
      fence.throwIfStale();
      await this.core.removeCloudTrustedDevice(peerId);
      signal.throwIfAborted();
      fence.throwIfStale();
      fence.commitSynchronous(() => {
        this.core?.removeCloudDeviceAddresses(peerId);
        this.core?.removeCloudDiscoveredDevice(peerId);
      });
    }
    for (const device of remoteDevices) {
      signal.throwIfAborted();
      fence.throwIfStale();
      const existing = this.core.getTrustedDevice(device.peerId);
      if (device.revokedAt) {
        fence.commitSynchronous(() => {
          this.core?.removeCloudDeviceAddresses(device.peerId);
          this.core?.removeCloudDiscoveredDevice(device.peerId);
        });
        continue;
      }
      const trustMode = existing?.trustMode === 'local-pairing' ? 'local-pairing' as const : 'cloud-account' as const;
      const trustedDevice = trustMode === 'cloud-account' ? committedByPeerId.get(device.peerId) : existing;
      if (!trustedDevice) throw new Error('cloud_directory_trust_snapshot_missing');
      const discoveredDevice = cloudRecordToDevice(device, trustMode, now, freshnessMs);
      fence.commitSynchronous(() => {
        if (trustMode === 'cloud-account') this.core?.upsertCloudTrustedDevice(trustedDevice);
        this.core?.setCloudDeviceAddresses(device.peerId, discoveredDevice.multiaddrs ?? []);
        this.core?.upsertCloudDiscoveredDevice(discoveredDevice);
      });
    }
    signal.throwIfAborted();
    fence.throwIfStale();
    fence.commitSynchronous(() => {
      this.cloudGrantCache.clear();
      this.lastCloudDevices = remoteDevices.filter(device => !device.revokedAt);
    });
  }

  private async resolveOutboundGrant(
    peerId: string,
    scope: ConnectionGrantScope,
    signal?: AbortSignal,
  ): Promise<DeviceConnectionGrant | undefined> {
    const trustedDevice = this.core?.getTrustedDevice(peerId);
    if (trustedDevice?.trustMode !== 'cloud-account') return undefined;
    if (!this.cloudConfig || !this.identity) {
      throw new Error('outbound_connection_grant_unavailable');
    }
    signal?.throwIfAborted();
    const cacheKey = JSON.stringify({ peerId, ...scope });
    const cached = this.cloudGrantCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached;
    try {
      const grant = await this.cloudConfig.client.createConnectionGrant({
        subjectPeerId: this.identity.peerId,
        allowedPeerIds: [peerId],
        ...scope,
      }, signal);
      signal?.throwIfAborted();
      this.cloudGrantCache.set(cacheKey, grant);
      return grant;
    } catch (error) {
      logger.warn('DeviceNetworkService outbound connection grant failed', {
        peerId,
        error: error instanceof Error ? error.message : String(error),
      });
      // A configured Cloud account changes the trust boundary: account peers
      // are admitted by a short-lived signed grant. Falling back to an
      // unauthenticated RPC here would silently turn a transient Cloud outage
      // into an authorization bypass.
      throw new Error('outbound_connection_grant_unavailable', { cause: error });
    }
  }

  private createLocalPairingAuthorizer(): LocalTrustDeviceAuthorizer {
    return new LocalTrustDeviceAuthorizer({
      getTrustedDevice: peerId => locallyPairedRecord(this.core?.getTrustedDevice(peerId)),
    });
  }

  private createCloudConfiguration(config: { cloudUrl: string; accessToken: string }): DesktopCloudConfiguration {
    const client = new CloudDeviceFetchClient({ baseUrl: config.cloudUrl, accessToken: config.accessToken });
    return { cloudUrl: client.baseUrl, accessToken: config.accessToken.trim(), client };
  }

  private persistCloudConfiguration(config: DesktopCloudConfiguration | undefined): void {
    if (!config) {
      settings.unsetSync(CLOUD_CONFIGURATION_KEY);
      getLocalAuthStore().delete(CLOUD_ACCESS_TOKEN_AUTH_KEY);
      return;
    }
    const record: StoredCloudConfigurationRecord = {
      cloudUrl: config.cloudUrl,
    };
    settings.setSync(CLOUD_CONFIGURATION_KEY, toElectronSettingsValue(record));
    getLocalAuthStore().set(CLOUD_ACCESS_TOKEN_AUTH_KEY, config.accessToken);
  }

  private loadPersistedCloudConfiguration(): void {
    if (this.cloudConfig) return;
    const stored = settings.getSync(CLOUD_CONFIGURATION_KEY);
    if (!isStoredCloudConfigurationRecord(stored)) return;
    const accessToken = getLocalAuthStore().get(CLOUD_ACCESS_TOKEN_AUTH_KEY);
    if (!accessToken) return;
    try {
      this.cloudConfig = this.createCloudConfiguration({
        cloudUrl: stored.cloudUrl,
        accessToken,
      });
    } catch (error) {
      logger.warn('DeviceNetworkService ignored invalid stored Cloud configuration', { error });
    }
  }

  private async refreshCapabilities(): Promise<void> {
    this.currentCapabilities = await this.buildCapabilities();
  }

  private async ensureIdentity(): Promise<void> {
    if (this.identity) return;
    const stored = settings.getSync(DEVICE_IDENTITY_KEY);
    if (isStoredIdentityRecord(stored)) {
      const identity = this.tryLoadStoredIdentity(stored);
      if (identity) {
        this.identity = identity;
        return;
      }
    }
    const identity = await this.createIdentity();
    await this.saveIdentity(identity);
    this.identity = identity;
  }

  private tryLoadStoredIdentity(stored: StoredIdentityRecord): RawSeedDeviceIdentity | undefined {
    const privateKeyRawSeedBase64Url = getLocalAuthStore().get(IDENTITY_PRIVATE_KEY_AUTH_KEY);
    if (!privateKeyRawSeedBase64Url) return undefined;
    return {
      peerId: stored.peerId,
      publicKeyMultibase: stored.publicKeyMultibase,
      privateKeyRef: 'libp2p-raw-seed',
      privateKeyRawSeedBase64Url,
      createdAt: stored.createdAt,
      deviceName: stored.deviceName,
      platform: 'desktop',
    };
  }

  private async createIdentity(): Promise<RawSeedDeviceIdentity> {
    return createDeviceIdentity('desktop', app.getName());
  }

  private async saveIdentity(identity: RawSeedDeviceIdentity): Promise<void> {
    const record: StoredIdentityRecord = {
      peerId: identity.peerId,
      publicKeyMultibase: identity.publicKeyMultibase,
      deviceName: identity.deviceName,
      platform: 'desktop',
      createdAt: identity.createdAt,
    };
    settings.setSync(DEVICE_IDENTITY_KEY, toElectronSettingsValue(record));
    getLocalAuthStore().set(IDENTITY_PRIVATE_KEY_AUTH_KEY, identity.privateKeyRawSeedBase64Url);
  }

  private async buildCapabilities(): Promise<DeviceCapabilities> {
    try {
      return await this.runtimeOptions.buildCapabilities?.() ?? emptyCapabilities;
    } catch (error) {
      logger.warn('DeviceNetworkService failed to collect runtime capabilities', { error });
    }
    return emptyCapabilities;
  }
}
