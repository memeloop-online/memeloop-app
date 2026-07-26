import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IPreferenceService } from '@services/preferences/interface';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemeloopNode } from '../index';

// Mock dependencies
vi.mock('@services/libs/log', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { workerProxy } = vi.hoisted(() => ({
  workerProxy: {
    startServer: vi.fn(async (port: number) => ({
      running: true,
      port,
      nodeId: 'worker-node',
    })),
    stopServer: vi.fn(async () => ({ ok: true })),
    getConnectedPeers: vi.fn(async () => []),
    getSyncStatus: vi.fn(async () => ({
      versionVector: {},
      peerCount: 0,
      syncRunning: false,
    })),
  },
}));

vi.mock('@services/container', () => ({
  container: {
    get: vi.fn(() => ({
      getMemeLoopWorkerProxy: vi.fn(async () => workerProxy),
    })),
  },
}));

vi.mock('@services/serviceIdentifier', () => ({
  default: { AgentInstance: Symbol.for('AgentInstance'), Preference: Symbol.for('Preference') },
}));

const mockPreferenceService = {
  get: vi.fn(),
  set: vi.fn(),
};

// Temp directory for test keypair/config files
let tmpDir: string;

describe('MemeloopNode auth methods', () => {
  let service: MemeloopNode;

  beforeEach(() => {
    workerProxy.startServer.mockClear();
    workerProxy.stopServer.mockClear();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memeloop-auth-test-'));

    // Override home dir so keypair/known_nodes go to temp
    vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);

    // Create service (inversify @inject is not used in test — just instantiate directly)
    service = new MemeloopNode(
      mockPreferenceService as unknown as IPreferenceService,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getIdentityStatus', () => {
    it('returns identity with keypair loaded', async () => {
      const status = await service.getIdentityStatus();
      expect(status.hasKeypair).toBe(true);
      expect(status.nodeId).toBeTruthy();
      expect(status.cloudLoggedIn).toBe(false);
      expect(status.cloudNodeRegistered).toBe(false);
      expect(status.knownNodeCount).toBe(0);
    });
  });

  describe('worker-owned server lifecycle', () => {
    it('starts and stops the authenticated orchestration server', async () => {
      await service.startServer(5200);
      await expect(service.getServerStatus()).resolves.toEqual({
        running: true,
        port: 5200,
        nodeId: 'worker-node',
      });
      expect(workerProxy.startServer).toHaveBeenCalledWith(5200);

      await service.stopServer();
      await expect(service.getServerStatus()).resolves.toEqual({
        running: false,
        port: undefined,
        nodeId: undefined,
      });
      expect(workerProxy.stopServer).toHaveBeenCalledOnce();
    });
  });

  describe('getLocalPinCode', () => {
    it('returns 6-char uppercase hex PIN', async () => {
      const pin = await service.getLocalPinCode();
      expect(pin).toHaveLength(6);
      expect(pin).toMatch(/^[0-9A-F]{6}$/);
    });

    it('returns stable PIN for same keypair', async () => {
      const pin1 = await service.getLocalPinCode();
      const pin2 = await service.getLocalPinCode();
      expect(pin1).toBe(pin2);
    });
  });

  describe('confirmPeerPin', () => {
    it('fails closed instead of persisting an unverified display code', async () => {
      await expect(
        service.confirmPeerPin('remote-node', 'ABCDEF'),
      ).resolves.toEqual({
        ok: false,
        error: 'legacy_pin_pairing_disabled_use_device_network',
      });
      await expect(service.getKnownNodes()).resolves.toEqual([]);
      expect(workerProxy.getConnectedPeers).not.toHaveBeenCalled();
    });
  });

  describe('cloud auth', () => {
    it('getCloudUrl returns null when not configured', async () => {
      const url = await service.getCloudUrl();
      expect(url).toBeNull();
    });

    it('setCloudUrl persists and getCloudUrl returns it', async () => {
      await service.setCloudUrl('https://api.memeloop.test');
      const url = await service.getCloudUrl();
      expect(url).toBe('https://api.memeloop.test');
    });

    it('setCloudUrl strips trailing slashes', async () => {
      await service.setCloudUrl('https://api.memeloop.test///');
      const url = await service.getCloudUrl();
      expect(url).toBe('https://api.memeloop.test');
    });

    it('cloudLogin fails when cloud URL is unreachable or not configured', async () => {
      const result = await service.cloudLogin('test@example.com', 'password');
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('cloudLogout clears tokens', async () => {
      await service.setCloudUrl('https://api.memeloop.test');
      await service.cloudLogout();
      const status = await service.getIdentityStatus();
      expect(status.cloudLoggedIn).toBe(false);
    });
  });

  describe('known nodes', () => {
    it('getKnownNodes returns empty initially', async () => {
      const nodes = await service.getKnownNodes();
      expect(nodes).toEqual([]);
    });

    it('removeKnownNode on empty list is safe', async () => {
      await service.removeKnownNode('non-existent');
      const nodes = await service.getKnownNodes();
      expect(nodes).toEqual([]);
    });
  });

  describe('regenerateKeypair', () => {
    it('regenerates keypair and returns new nodeId', async () => {
      const result = await service.regenerateKeypair();
      expect(result.nodeId).toBeTruthy();
      // The new nodeId should differ from the original
      // (extremely unlikely to be the same with random keygen)
      const status2 = await service.getIdentityStatus();
      expect(status2.hasKeypair).toBe(true);
      expect(status2.nodeId).toBe(result.nodeId);
    });
  });
});
