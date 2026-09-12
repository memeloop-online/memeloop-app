import type {
  AgentAttachmentUploadSource,
  BeginAttachmentUploadRequest,
  CommitAttachmentUploadRequest,
  RemoteAgentExecutionProvenance,
  UploadAttachmentChunkRequest,
} from 'memeloop';
import { ATTACHMENT_UPLOAD_LIMITS, ATTACHMENT_UPLOAD_RPC_METHODS } from 'memeloop/device-network';
import { describe, expect, it, vi } from 'vitest';

import { createDesktopExecutionCoordinator, type DesktopExecutionCoordinatorAdapterOptions } from '../executionCoordinatorAdapter';

const provenance: RemoteAgentExecutionProvenance = {
  conversationId: 'conversation-1',
  definitionId: 'definition-1',
  requestId: 'request-1',
  turnId: 'turn-1',
};

function localPorts(): Pick<
  DesktopExecutionCoordinatorAdapterOptions,
  'cancelLocal' | 'deleteLocal' | 'executeLocal' | 'retryLocal'
> {
  return {
    cancelLocal: vi.fn().mockResolvedValue(undefined),
    deleteLocal: vi.fn().mockResolvedValue({ ok: true }),
    executeLocal: vi.fn().mockResolvedValue({ runId: 'local-run' }),
    retryLocal: vi.fn().mockResolvedValue({ runId: 'local-retry' }),
  };
}

function sourceFromBytes(bytes: Uint8Array): AgentAttachmentUploadSource {
  return {
    kind: 'source',
    filename: 'attachment.bin',
    mimeType: 'application/octet-stream',
    totalBytes: bytes.byteLength,
    async readChunk(offset, maximumBytes, options) {
      options?.signal?.throwIfAborted();
      return offset >= bytes.byteLength
        ? null
        : bytes.slice(offset, Math.min(bytes.byteLength, offset + maximumBytes));
    },
  };
}

function completedStatus(runId: unknown) {
  return {
    runId,
    requestId: provenance.requestId,
    turnId: provenance.turnId,
    conversationId: provenance.conversationId,
    definitionId: provenance.definitionId,
    requestPeerId: 'peer-local',
    payloadDigest: 'digest-remote',
    state: 'completed' as const,
    acceptedAt: 1,
    updatedAt: 2,
  };
}

function createCoordinator(
  sendRpc: (peerId: string, method: string, parameters: unknown) => Promise<unknown>,
) {
  let operationSequence = 0;
  const syncWithDevice = vi.fn().mockResolvedValue(undefined);
  const abortOperation = vi.fn().mockResolvedValue(undefined);
  const coordinator = createDesktopExecutionCoordinator({
    ...localPorts(),
    localPeerId: 'peer-local',
    createOperationId: () => `operation-${++operationSequence}`,
    createProvenanceId: () => `id-${operationSequence}`,
    deviceNetwork: {
      sendRpc: async (peerId: string, method: string, parameters: unknown) => await sendRpc(peerId, method, parameters),
      syncWithDevice,
      abortOperation,
      finishOperation: vi.fn().mockResolvedValue(undefined),
    },
    pollIntervalMs: 1,
  });
  return { abortOperation, coordinator, syncWithDevice };
}

describe('createDesktopExecutionCoordinator', () => {
  it('aborts the in-flight status read once and dispatches cancellation with the tracked run id', async () => {
    let rejectStatus: ((reason: Error) => void) | undefined;
    let operationSequence = 0;
    const sendRpc = vi.fn(async (
      _peerId: string,
      method: string,
      parameters: unknown,
    ) => {
      const request = parameters as Record<string, unknown>;
      if (method === 'memeloop.agent.runTurn') {
        return {
          ok: true,
          state: 'accepted',
          runId: 'remote-run',
          requestId: request.requestId,
          turnId: request.turnId,
          conversationId: request.conversationId,
        };
      }
      if (method === 'memeloop.agent.getRunStatus') {
        return await new Promise<never>((_resolve, reject) => {
          rejectStatus = reject;
        });
      }
      if (method === 'memeloop.agent.cancel') {
        expect(request).toEqual({ runId: 'remote-run' });
        return { ok: true, status: null };
      }
      throw new Error(`unexpected_rpc:${method}`);
    });
    const abortOperation = vi.fn(async () => {
      rejectStatus?.(new DOMException('Aborted', 'AbortError'));
    });
    const coordinator = createDesktopExecutionCoordinator({
      ...localPorts(),
      localPeerId: 'peer-local',
      createOperationId: () => `operation-${++operationSequence}`,
      createProvenanceId: () => `id-${operationSequence}`,
      deviceNetwork: {
        sendRpc: async (peerId: string, method: string, parameters: unknown) => await sendRpc(peerId, method, parameters),
        syncWithDevice: vi.fn().mockResolvedValue(undefined),
        abortOperation,
        finishOperation: vi.fn().mockResolvedValue(undefined),
      },
      pollIntervalMs: 1,
    });

    const execution = coordinator.execute({
      target: { kind: 'remote', peerId: 'peer-remote' },
      provenance,
      message: 'hello',
    });
    await vi.waitFor(() => {
      expect(sendRpc.mock.calls.some(call => call[1] === 'memeloop.agent.getRunStatus')).toBe(true);
    });
    await coordinator.cancel({
      target: { kind: 'remote', peerId: 'peer-remote' },
      provenance,
    });

    await expect(execution).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(abortOperation).toHaveBeenCalledOnce();
    expect(sendRpc.mock.calls.filter(call => call[1] === 'memeloop.agent.cancel')).toHaveLength(1);
    expect(coordinator.getSnapshot(provenance.conversationId)).toMatchObject({
      status: 'cancelled',
      operation: 'cancel',
      provenance,
      synchronization: 'synchronized',
    });
  });

  it('accepts an exact maximum chunk and rejects a source returning max + 1 bytes', async () => {
    const sendRpc = vi.fn(async (_peerId: string, method: string, parameters: unknown) => {
      const request = parameters as Record<string, unknown>;
      if (method === ATTACHMENT_UPLOAD_RPC_METHODS.begin) {
        return {
          ok: true,
          requestId: request.requestId,
          conversationId: request.conversationId,
          uploadId: 'upload-boundary',
          totalBytes: request.totalBytes,
          maxChunkBytes: ATTACHMENT_UPLOAD_LIMITS.chunkBytes,
        };
      }
      if (method === ATTACHMENT_UPLOAD_RPC_METHODS.chunk) {
        return {
          ok: true,
          requestId: request.requestId,
          conversationId: request.conversationId,
          uploadId: request.uploadId,
          offset: request.offset,
          byteLength: request.byteLength,
        };
      }
      if (method === ATTACHMENT_UPLOAD_RPC_METHODS.commit) {
        return {
          ok: true,
          requestId: request.requestId,
          conversationId: request.conversationId,
          uploadId: request.uploadId,
          attachment: {
            contentHash: request.sha256,
            filename: 'attachment.bin',
            mimeType: 'application/octet-stream',
            size: request.size,
          },
        };
      }
      if (method === 'memeloop.agent.runTurn') {
        return {
          ok: true,
          state: 'accepted',
          runId: 'run-boundary',
          requestId: request.requestId,
          turnId: request.turnId,
          conversationId: request.conversationId,
        };
      }
      if (method === 'memeloop.agent.getRunStatus') {
        return { status: completedStatus(request.runId) };
      }
      throw new Error(`unexpected_rpc:${method}`);
    });
    const { coordinator } = createCoordinator(sendRpc);
    const exactBytes = new Uint8Array(ATTACHMENT_UPLOAD_LIMITS.chunkBytes);

    await coordinator.execute({
      target: { kind: 'remote', peerId: 'peer-remote' },
      provenance,
      message: 'exact chunk',
      attachment: sourceFromBytes(exactBytes),
    });
    const chunkCall = sendRpc.mock.calls.find(call => call[1] === ATTACHMENT_UPLOAD_RPC_METHODS.chunk);
    expect(chunkCall?.[2]).toMatchObject({
      byteLength: ATTACHMENT_UPLOAD_LIMITS.chunkBytes,
      offset: 0,
    });

    const oversizedSource: AgentAttachmentUploadSource = {
      kind: 'source',
      filename: 'oversized.bin',
      mimeType: 'application/octet-stream',
      totalBytes: ATTACHMENT_UPLOAD_LIMITS.chunkBytes + 1,
      readChunk: vi.fn().mockResolvedValue(
        new Uint8Array(ATTACHMENT_UPLOAD_LIMITS.chunkBytes + 1),
      ),
    };
    await expect(coordinator.execute({
      target: { kind: 'remote', peerId: 'peer-remote' },
      provenance: { ...provenance, requestId: 'request-oversized', turnId: 'turn-oversized' },
      message: 'oversized chunk',
      attachment: oversizedSource,
    })).rejects.toMatchObject({ code: 'PORT_FAILURE' });
    expect(sendRpc.mock.calls.filter(call => call[1] === ATTACHMENT_UPLOAD_RPC_METHODS.chunk)).toHaveLength(1);
  });

  it('cancels during a source read before a run id exists without committing or dispatching', async () => {
    let observedReadSignal: AbortSignal | undefined;
    const sendRpc = vi.fn(async (_peerId: string, method: string, parameters: unknown) => {
      const request = parameters as Record<string, unknown>;
      if (method === ATTACHMENT_UPLOAD_RPC_METHODS.begin) {
        return {
          ok: true,
          requestId: request.requestId,
          conversationId: request.conversationId,
          uploadId: 'upload-cancel',
          totalBytes: request.totalBytes,
          maxChunkBytes: ATTACHMENT_UPLOAD_LIMITS.chunkBytes,
        };
      }
      throw new Error(`unexpected_rpc:${method}`);
    });
    const source: AgentAttachmentUploadSource = {
      kind: 'source',
      filename: 'cancel.bin',
      mimeType: 'application/octet-stream',
      totalBytes: 1,
      readChunk: async (_offset, _maximumBytes, options) => {
        observedReadSignal = options?.signal;
        return await new Promise<Uint8Array>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            const reason = options.signal?.reason;
            reject(reason instanceof Error ? reason : new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
      },
    };
    const { coordinator } = createCoordinator(sendRpc);
    const execution = coordinator.execute({
      target: { kind: 'remote', peerId: 'peer-remote' },
      provenance,
      message: 'cancel upload',
      attachment: source,
    });
    await vi.waitFor(() => {
      expect(observedReadSignal).toBeDefined();
    });

    await coordinator.cancel({
      target: { kind: 'remote', peerId: 'peer-remote' },
      provenance,
    });

    await expect(execution).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(observedReadSignal?.aborted).toBe(true);
    expect(sendRpc.mock.calls.some(call => call[1] === ATTACHMENT_UPLOAD_RPC_METHODS.commit)).toBe(false);
    expect(sendRpc.mock.calls.some(call => call[1] === 'memeloop.agent.runTurn')).toBe(false);
  });

  it('reuses identical canonical upload fingerprints and commit payloads across execution retries', async () => {
    let runSequence = 0;
    const sendRpc = vi.fn(async (_peerId: string, method: string, parameters: unknown) => {
      const request = parameters as Record<string, unknown>;
      if (method === ATTACHMENT_UPLOAD_RPC_METHODS.begin) {
        return {
          ok: true,
          requestId: request.requestId,
          conversationId: request.conversationId,
          uploadId: 'upload-replay',
          totalBytes: request.totalBytes,
          maxChunkBytes: ATTACHMENT_UPLOAD_LIMITS.chunkBytes,
        };
      }
      if (method === ATTACHMENT_UPLOAD_RPC_METHODS.chunk) {
        return {
          ok: true,
          requestId: request.requestId,
          conversationId: request.conversationId,
          uploadId: request.uploadId,
          offset: request.offset,
          byteLength: request.byteLength,
        };
      }
      if (method === ATTACHMENT_UPLOAD_RPC_METHODS.commit) {
        return {
          ok: true,
          requestId: request.requestId,
          conversationId: request.conversationId,
          uploadId: request.uploadId,
          attachment: {
            contentHash: request.sha256,
            filename: 'attachment.bin',
            mimeType: 'application/octet-stream',
            size: request.size,
          },
        };
      }
      if (method === 'memeloop.agent.runTurn') {
        return {
          ok: true,
          state: 'accepted',
          runId: `run-replay-${++runSequence}`,
          requestId: request.requestId,
          turnId: request.turnId,
          conversationId: request.conversationId,
        };
      }
      if (method === 'memeloop.agent.getRunStatus') {
        return { status: completedStatus(request.runId) };
      }
      throw new Error(`unexpected_rpc:${method}`);
    });
    const { coordinator } = createCoordinator(sendRpc);
    const execute = () =>
      coordinator.execute({
        target: { kind: 'remote' as const, peerId: 'peer-remote' },
        provenance,
        message: 'replay upload',
        attachment: sourceFromBytes(new Uint8Array([1, 2, 3, 4])),
      });

    await execute();
    await execute();

    const beginRequests = sendRpc.mock.calls
      .filter(call => call[1] === ATTACHMENT_UPLOAD_RPC_METHODS.begin)
      .map(call => call[2] as BeginAttachmentUploadRequest);
    const chunkRequests = sendRpc.mock.calls
      .filter(call => call[1] === ATTACHMENT_UPLOAD_RPC_METHODS.chunk)
      .map(call => call[2] as UploadAttachmentChunkRequest);
    const commitRequests = sendRpc.mock.calls
      .filter(call => call[1] === ATTACHMENT_UPLOAD_RPC_METHODS.commit)
      .map(call => call[2] as CommitAttachmentUploadRequest);
    expect(beginRequests).toHaveLength(2);
    expect(chunkRequests).toHaveLength(2);
    expect(commitRequests).toHaveLength(2);
    expect(beginRequests[1]).toEqual(beginRequests[0]);
    expect(chunkRequests[1]).toEqual(chunkRequests[0]);
    expect(commitRequests[1]).toEqual(commitRequests[0]);
    expect(commitRequests[0]).toMatchObject({
      size: 4,
      sha256: expect.stringMatching(/^sha256:[\da-f]{64}$/u),
    });
  });
});
