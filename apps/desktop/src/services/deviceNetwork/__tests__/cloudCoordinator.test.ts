import { buildDeviceHeartbeatMessage, type DeviceCloudConnectionAdapter, type DeviceCloudStepResult } from 'memeloop/device-network';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDesktopCloudConnectionCoordinator, type DesktopIdentityPayloadSigner, desktopRelayRequiredForOnline, signDesktopCloudHeartbeat } from '../cloudCoordinator';

type Configuration = { id: string };

function successfulAdapter(
  overrides: Partial<Omit<DeviceCloudConnectionAdapter<Configuration>, 'relayRequiredForOnline'>> = {},
): Omit<DeviceCloudConnectionAdapter<Configuration>, 'relayRequiredForOnline'> {
  return {
    isConfigured: (configuration): configuration is Configuration => configuration !== undefined,
    ensureAuthorizer: () => Promise.resolve(undefined),
    registerDevice: () => Promise.resolve(undefined),
    ensureRelay: () => Promise.resolve(undefined),
    heartbeat: () => Promise.resolve(undefined),
    syncDirectory: () => Promise.resolve(undefined),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Desktop Cloud coordinator host wiring', () => {
  it('reports relay failure as degraded behind a private address and leaves no shutdown timer', async () => {
    vi.useFakeTimers();
    const coordinator = createDesktopCloudConnectionCoordinator({
      adapter: successfulAdapter({
        ensureRelay: () => Promise.reject(new Error('relay unavailable')),
      }),
      getMultiaddrs: () => ['/ip4/192.168.1.20/tcp/43111/p2p/desktop-peer'],
      heartbeatIntervalMs: 60_000,
      jitterRatio: 0,
    });

    await coordinator.setConfiguration({ id: 'account-a' });
    await coordinator.start();

    expect(coordinator.snapshot.status).toBe('degraded');
    expect(coordinator.snapshot.components).toMatchObject({
      authorizer: 'ready',
      registration: 'ready',
      relay: 'failed',
      heartbeat: 'ready',
      directory: 'ready',
    });
    expect(vi.getTimerCount()).toBe(1);

    await coordinator.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts an old configuration generation before it can commit state', async () => {
    vi.useFakeTimers();
    let resolveFirst!: (result: DeviceCloudStepResult) => void;
    const firstAuthorizer = new Promise<DeviceCloudStepResult>(resolve => {
      resolveFirst = result => {
        resolve(result);
      };
    });
    const committed: string[] = [];
    const ensureAuthorizer = vi.fn(async (configuration: Configuration) => {
      if (configuration.id === 'account-a') return firstAuthorizer;
      return {
        commit: fence => {
          fence.commitSynchronous(() => committed.push(configuration.id));
          return Promise.resolve();
        },
      } satisfies DeviceCloudStepResult;
    });
    const coordinator = createDesktopCloudConnectionCoordinator({
      adapter: successfulAdapter({ ensureAuthorizer }),
      getMultiaddrs: () => ['/dns4/desktop.example.com/tcp/443/wss/p2p/desktop-peer'],
      heartbeatIntervalMs: 60_000,
      jitterRatio: 0,
    });

    await coordinator.setConfiguration({ id: 'account-a' });
    const starting = coordinator.start();
    await vi.waitFor(() => {
      expect(ensureAuthorizer).toHaveBeenCalledTimes(1);
    });
    const switching = coordinator.setConfiguration({ id: 'account-b' });
    resolveFirst({
      commit: fence => {
        fence.commitSynchronous(() => committed.push('account-a'));
        return Promise.resolve();
      },
    });
    await Promise.all([starting, switching]);

    expect(committed).toEqual(['account-b']);
    expect(coordinator.snapshot.generation).toBe(2);
    expect(coordinator.snapshot.status).toBe('online');
    await coordinator.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the Desktop public-direct-address rule', () => {
    expect(desktopRelayRequiredForOnline(['/ip4/10.1.2.3/tcp/43111/p2p/peer'])).toBe(true);
    expect(desktopRelayRequiredForOnline(['/dns4/desktop.example.com/tcp/443/wss/p2p/peer'])).toBe(false);
    expect(desktopRelayRequiredForOnline([
      '/dns4/relay.example.com/tcp/443/wss/p2p/relay/p2p-circuit/p2p/peer',
    ])).toBe(true);
  });
});

describe('Desktop signed heartbeat', () => {
  it('signs the nonce-bound canonical heartbeat and honors cancellation', async () => {
    const controller = new AbortController();
    const identity = {
      peerId: 'desktop-peer',
      publicKeyMultibase: 'zPublicKey',
      privateKeyRef: 'test-key',
      createdAt: 1,
      deviceName: 'Desktop',
      platform: 'desktop' as const,
    };
    const message = {
      peerId: identity.peerId,
      timestamp: 1_750_000_000_000,
      capabilities: {
        tools: ['shell'],
        mcpServers: [],
        hasWiki: true,
        agentLoop: true,
        imChannels: [],
        wikis: [],
      },
      multiaddrs: ['/dns4/desktop.example.com/tcp/443/wss/p2p/desktop-peer'],
      relayReservations: [],
    };
    let signedPayload: Uint8Array | undefined;
    const signPayload = vi.fn(async (input: Parameters<DesktopIdentityPayloadSigner>[0]) => {
      signedPayload = input.payload;
      return 'heartbeat-signature';
    });

    await expect(signDesktopCloudHeartbeat({
      identity,
      message,
      signal: controller.signal,
      nonce: 'nonce-a',
      signPayload,
    })).resolves.toEqual({ nonce: 'nonce-a', signature: 'heartbeat-signature' });
    expect(signPayload).toHaveBeenCalledOnce();
    expect(signedPayload).toEqual(
      buildDeviceHeartbeatMessage({ ...message, nonce: 'nonce-a' }),
    );

    controller.abort(new Error('configuration changed'));
    await expect(signDesktopCloudHeartbeat({
      identity,
      message,
      signal: controller.signal,
      nonce: 'nonce-b',
      signPayload,
    })).rejects.toThrow('configuration changed');
  });
});
