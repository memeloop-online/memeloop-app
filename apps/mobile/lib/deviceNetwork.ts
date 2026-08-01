import 'react-native-get-random-values';

import {
  createDeviceIdentity,
  Libp2pDeviceNetworkService,
  parseVerifiedDevicePairingInvite,
  type RawSeedDeviceIdentity,
} from '@memeloop/libp2p/browser';
import * as SecureStore from 'expo-secure-store';
import {
  type Device,
  type DeviceNetworkService,
  type DevicePairingInvite,
  type DeviceTrustStore,
  type PairingSession,
  type TrustedDeviceRecord,
} from 'memeloop/device-network';

const IDENTITY_KEY = 'memeloop.device.identity.v1';
const TRUST_INDEX_KEY = 'memeloop.device.trust.index.v1';
const TRUST_KEY_PREFIX = 'memeloop.device.trust.v1.';
const ADDRESS_KEY_PREFIX = 'memeloop.device.addresses.v1.';

function trustKey(peerId: string): string {
  return `${TRUST_KEY_PREFIX}${encodeURIComponent(peerId)}`;
}

function addressKey(peerId: string): string {
  return `${ADDRESS_KEY_PREFIX}${encodeURIComponent(peerId)}`;
}

function isIdentity(value: unknown): value is RawSeedDeviceIdentity {
  const record = value as Record<string, unknown> | undefined;
  return Boolean(
    record &&
      typeof record.peerId === 'string' &&
      typeof record.publicKeyMultibase === 'string' &&
      typeof record.privateKeyRawSeedBase64Url === 'string' &&
      record.platform === 'mobile',
  );
}

function isTrustedDevice(value: unknown): value is TrustedDeviceRecord {
  const record = value as Record<string, unknown> | undefined;
  return Boolean(
    record &&
      typeof record.peerId === 'string' &&
      typeof record.publicKeyMultibase === 'string' &&
      typeof record.deviceName === 'string' &&
      typeof record.createdAt === 'number',
  );
}

async function readJson(key: string): Promise<unknown> {
  const serialized = await SecureStore.getItemAsync(key);
  if (!serialized) return undefined;
  try {
    return JSON.parse(serialized);
  } catch {
    return undefined;
  }
}

class SecureDeviceTrustStore implements DeviceTrustStore {
  async loadTrustedDevices(): Promise<TrustedDeviceRecord[]> {
    const index = await readJson(TRUST_INDEX_KEY);
    if (!Array.isArray(index)) return [];
    const records = await Promise.all(
      index
        .filter((peerId): peerId is string => typeof peerId === 'string')
        .map((peerId) => readJson(trustKey(peerId))),
    );
    return records.filter(isTrustedDevice);
  }

  async saveTrustedDevice(record: TrustedDeviceRecord): Promise<void> {
    const records = await this.loadTrustedDevices();
    const peerIds = [
      ...new Set([...records.map(({ peerId }) => peerId), record.peerId]),
    ];
    await Promise.all([
      SecureStore.setItemAsync(trustKey(record.peerId), JSON.stringify(record)),
      SecureStore.setItemAsync(TRUST_INDEX_KEY, JSON.stringify(peerIds)),
    ]);
  }

  async removeTrustedDevice(peerId: string): Promise<void> {
    const records = await this.loadTrustedDevices();
    await Promise.all([
      SecureStore.deleteItemAsync(trustKey(peerId)),
      SecureStore.setItemAsync(
        TRUST_INDEX_KEY,
        JSON.stringify(
          records
            .map((record) => record.peerId)
            .filter((current) => current !== peerId),
        ),
      ),
    ]);
  }
}

export interface MobileDeviceNetworkState {
  status: 'idle' | 'starting' | 'online' | 'error';
  localDevice?: Device;
  devices: Device[];
  pairingSessions: PairingSession[];
  error?: string;
}

class MobileDeviceNetworkController {
  private service?: Libp2pDeviceNetworkService;
  private startPromise?: Promise<void>;
  private unsubscribers: Array<() => void> = [];
  private listeners = new Set<(state: MobileDeviceNetworkState) => void>();
  private state: MobileDeviceNetworkState = {
    status: 'idle',
    devices: [],
    pairingSessions: [],
  };

  getState(): MobileDeviceNetworkState {
    return this.state;
  }

  getService(): DeviceNetworkService {
    if (!this.service) throw new Error('Mobile device network is not started');
    return this.service;
  }

  subscribe(listener: (state: MobileDeviceNetworkState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    this.startPromise ??= this.startInternal();
    return this.startPromise;
  }

  async pair(serializedInvite: string): Promise<PairingSession> {
    await this.start();
    const invite = await parseVerifiedDevicePairingInvite(serializedInvite);
    return this.service!.requestLocalPairing(invite.peerId, {
      multiaddrs: invite.multiaddrs,
    });
  }

  async accept(sessionId: string): Promise<void> {
    const session = this.state.pairingSessions.find(
      (current) => current.sessionId === sessionId,
    );
    if (!session || !this.service) throw new Error('Pairing session not found');
    await SecureStore.setItemAsync(
      addressKey(session.remotePeerId),
      JSON.stringify(session.remoteMultiaddrs),
    );
    await this.service.acceptPairing(sessionId);
  }

  async reject(sessionId: string): Promise<void> {
    await this.service?.rejectPairing(sessionId);
  }

  async remove(peerId: string): Promise<void> {
    await this.service?.removeTrustedDevice(peerId);
    await SecureStore.deleteItemAsync(addressKey(peerId));
  }

  private async startInternal(): Promise<void> {
    this.setState({ status: 'starting', error: undefined });
    try {
      const identity = await this.loadIdentity();
      const bootstrapMultiaddrs = await this.loadBootstrapMultiaddrs();
      this.service = new Libp2pDeviceNetworkService({
        identity,
        trustStore: new SecureDeviceTrustStore(),
        listen: { addresses: [] },
        enableCircuitRelay: true,
        bootstrapMultiaddrs,
        capabilities: {
          tools: [],
          mcpServers: [],
          hasWiki: false,
          agentLoop: false,
          imChannels: [],
          wikis: [],
        },
      });
      await this.service.start();
      this.unsubscribers.push(
        this.service.observeDevices((devices) => this.setState({ devices })),
        this.service.observePairingSessions((pairingSessions) =>
          this.setState({ pairingSessions })
        ),
      );
      this.setState({
        status: 'online',
        localDevice: await this.service.getLocalDevice(),
      });
    } catch (error) {
      this.startPromise = undefined;
      this.setState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Device network failed',
      });
      throw error;
    }
  }

  private async loadIdentity(): Promise<RawSeedDeviceIdentity> {
    const stored = await readJson(IDENTITY_KEY);
    if (isIdentity(stored)) return stored;
    const identity = await createDeviceIdentity('mobile', 'MemeLoop Mobile');
    await SecureStore.setItemAsync(IDENTITY_KEY, JSON.stringify(identity));
    return identity;
  }

  private async loadBootstrapMultiaddrs(): Promise<string[]> {
    const peerIds = await readJson(TRUST_INDEX_KEY);
    if (!Array.isArray(peerIds)) return [];
    const stored = await Promise.all(
      peerIds
        .filter((peerId): peerId is string => typeof peerId === 'string')
        .map((peerId) => readJson(addressKey(peerId))),
    );
    return [
      ...new Set(
        stored.flatMap((addresses) =>
          Array.isArray(addresses)
            ? addresses.filter(
                (address): address is string => typeof address === 'string',
              )
            : []
        ),
      ),
    ];
  }

  private setState(
    update: Partial<MobileDeviceNetworkState>,
  ): void {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener(this.state);
  }
}

export const mobileDeviceNetwork = new MobileDeviceNetworkController();
export type { DevicePairingInvite };
