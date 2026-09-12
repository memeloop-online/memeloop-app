import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => {
  const settingsValues = new Map<string, unknown>();
  const authValues = new Map<string, string>();
  const settings = {
    getSync: vi.fn((key: string) => settingsValues.get(key)),
    setSync: vi.fn((key: string, value: unknown) => settingsValues.set(key, value)),
    unsetSync: vi.fn((key: string) => settingsValues.delete(key)),
  };
  const authStore = {
    get: vi.fn((key: string) => authValues.get(key)),
    set: vi.fn((key: string, value: string) => authValues.set(key, value)),
    delete: vi.fn((key: string) => authValues.delete(key)),
  };
  return {
    settingsValues,
    authValues,
    settings,
    authStore,
  };
});

vi.mock('electron-settings', () => ({ default: fixtures.settings }));

vi.mock('@services/libs/authFileStore', () => ({
  getLocalAuthStore: () => fixtures.authStore,
}));

import { DeviceNetworkService } from '../index';

type DeviceNetworkPersistenceAccess = {
  cloudConfig?: { cloudUrl: string; accessToken: string };
  loadPersistedCloudConfiguration(): void;
};

type DeviceNetworkIdentityAccess = {
  createIdentity(): Promise<unknown>;
};

beforeEach(() => {
  fixtures.settingsValues.clear();
  fixtures.authValues.clear();
  fixtures.settings.getSync.mockClear();
  fixtures.settings.setSync.mockClear();
  fixtures.settings.unsetSync.mockClear();
  fixtures.authStore.get.mockClear();
  fixtures.authStore.set.mockClear();
  fixtures.authStore.delete.mockClear();
});

describe('DeviceNetworkService local auth persistence', () => {
  it('switches and clears the Cloud token through the local auth store', async () => {
    const service = new DeviceNetworkService();

    await service.configureCloud({
      cloudUrl: 'https://cloud.example.com',
      accessToken: 'first-token',
    });
    await service.configureCloud({
      cloudUrl: 'https://cloud.example.com',
      accessToken: 'second-token',
    });

    expect(fixtures.authStore.set).toHaveBeenLastCalledWith(
      'deviceNetwork.cloud.accessToken.v1',
      'second-token',
    );
    expect(fixtures.settingsValues.get('deviceNetwork.cloudConfiguration.v1')).toEqual({
      cloudUrl: 'https://cloud.example.com',
    });
    expect(fixtures.settingsValues.get('deviceNetwork.cloudConfiguration.v1')).not.toHaveProperty('accessToken');
    expect(fixtures.settingsValues.get('deviceNetwork.cloudConfiguration.v1')).not.toHaveProperty('encryptedAccessToken');

    const restarted = new DeviceNetworkService() as unknown as DeviceNetworkPersistenceAccess;
    restarted.loadPersistedCloudConfiguration();
    expect(restarted.cloudConfig).toMatchObject({ accessToken: 'second-token' });

    await service.configureCloud();
    expect(fixtures.authStore.delete).toHaveBeenCalledWith('deviceNetwork.cloud.accessToken.v1');
    expect(fixtures.settingsValues.has('deviceNetwork.cloudConfiguration.v1')).toBe(false);
  });

  it('restores a stable identity from the app-local seed without Keychain storage', async () => {
    const generatedIdentity = {
      peerId: 'desktop-peer',
      publicKeyMultibase: 'zPublicKey',
      privateKeyRef: 'libp2p-raw-seed',
      privateKeyRawSeedBase64Url: 'private-seed',
      createdAt: 1_750_000_000_000,
      deviceName: 'MemeLoop Desktop',
      platform: 'desktop',
    };
    const firstService = new DeviceNetworkService();
    const createIdentity = vi.spyOn(
      firstService as unknown as DeviceNetworkIdentityAccess,
      'createIdentity',
    ).mockResolvedValue(generatedIdentity);

    const first = await firstService.getLocalIdentity();
    expect(first).toMatchObject({ peerId: 'desktop-peer' });
    expect(fixtures.authStore.set).toHaveBeenCalledWith(
      'deviceNetwork.identity.privateKeyRawSeed.v1',
      'private-seed',
    );
    expect(fixtures.settingsValues.get('deviceNetwork.identity.v1')).toEqual({
      peerId: 'desktop-peer',
      publicKeyMultibase: 'zPublicKey',
      deviceName: 'MemeLoop Desktop',
      platform: 'desktop',
      createdAt: 1_750_000_000_000,
    });

    const restored = await new DeviceNetworkService().getLocalIdentity();
    expect(restored).toMatchObject({
      peerId: 'desktop-peer',
      privateKeyRawSeedBase64Url: 'private-seed',
    });
    expect(createIdentity).toHaveBeenCalledTimes(1);
  });
});
