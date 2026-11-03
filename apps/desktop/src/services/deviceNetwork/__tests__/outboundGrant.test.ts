import { describe, expect, it, vi } from 'vitest';

import { DeviceNetworkService } from '../index';

describe('DeviceNetworkService outbound grants', () => {
  it('fails closed when a configured Cloud account cannot issue a grant', async () => {
    const sendRpc = vi.fn();
    const service = new DeviceNetworkService();
    const createConnectionGrant = vi.fn().mockRejectedValue(new Error('cloud unavailable'));
    Object.assign(service, {
      cloudConfig: {
        client: { createConnectionGrant },
        cloudUrl: 'https://cloud.example.com',
        accessToken: 'access-token',
      },
      core: {
        getTrustedDevice: () => ({ peerId: 'remote-peer', trustMode: 'cloud-account' }),
        sendRpc,
      },
      identity: { peerId: 'local-peer' },
    });

    await expect(service.sendRpc('remote-peer', 'memeloop.agent.runTurn', {
      conversationId: 'conversation-1',
      definitionId: 'definition-1',
    })).rejects.toThrow('outbound_connection_grant_unavailable');
    expect(createConnectionGrant).toHaveBeenCalledWith({
      subjectPeerId: 'local-peer',
      allowedPeerIds: ['remote-peer'],
      protocols: ['/memeloop/rpc/2.0.0'],
      rpcMethodScope: { mode: 'ids', ids: ['memeloop.agent.runTurn'] },
      conversationScope: { mode: 'ids', ids: ['conversation-1'] },
      definitionScope: { mode: 'ids', ids: ['definition-1'] },
    }, undefined);
    expect(sendRpc).not.toHaveBeenCalled();
  });

  it('cancels a renderer RPC through a serializable operation id', async () => {
    const service = new DeviceNetworkService();
    const sendRpc = vi.fn((
      _peerId: string,
      _method: string,
      _parameters: unknown,
      options: { signal?: AbortSignal },
    ) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(options.signal?.reason instanceof Error ? options.signal.reason : new Error('device_operation_cancelled'));
        }, { once: true });
      })
    );
    Object.assign(service, {
      core: { sendRpc },
    });

    const pending = service.sendRpc('remote-peer', 'memeloop.schedule.list', {}, {
      operationId: 'renderer-operation-1',
      presentedGrant: {} as never,
    });
    await Promise.resolve();
    await service.abortOperation('renderer-operation-1');

    await expect(pending).rejects.toThrow('device_operation_cancelled');
    expect(sendRpc.mock.calls[0]?.[3]?.signal?.aborted).toBe(true);
    await service.finishOperation('renderer-operation-1');
  });

  it('cancels a renderer sync through a serializable operation id', async () => {
    const service = new DeviceNetworkService();
    const syncWithDevice = vi.fn((
      _peerId: string,
      options: { signal?: AbortSignal },
    ) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(options.signal?.reason instanceof Error ? options.signal.reason : new Error('device_operation_cancelled'));
        }, { once: true });
      })
    );
    Object.assign(service, {
      core: { syncWithDevice },
    });

    const pending = service.syncWithDevice('remote-peer', {
      operationId: 'renderer-sync-1',
      presentedGrant: {} as never,
      conversationIds: ['conversation-1'],
    });
    await Promise.resolve();
    await service.abortOperation('renderer-sync-1');

    await expect(pending).rejects.toThrow('device_operation_cancelled');
    expect(syncWithDevice.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    await service.finishOperation('renderer-sync-1');
  });
});
