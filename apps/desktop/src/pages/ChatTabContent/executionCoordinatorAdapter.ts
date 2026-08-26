import { Sha256 } from '@aws-crypto/sha256-js';
import {
  type AgentAttachmentInput,
  type AgentAttachmentUploadSource,
  type AttachmentReference,
  type RemoteAgentCancelRequest,
  type RemoteAgentDeleteRequest,
  type RemoteAgentDeleteResult,
  type RemoteAgentExecuteRequest,
  RemoteAgentExecutionCoordinator,
  type RemoteAgentExecutionCoordinatorOptions,
  type RemoteAgentExecutionResult,
  type RemoteAgentRetryRequest,
} from 'memeloop';
import { ATTACHMENT_UPLOAD_LIMITS, buildAttachmentUploadChunkRequest, createAgentDeviceRpcClient, type DeviceConnectionGrant } from 'memeloop/device-network';

const REMOTE_RUN_POLL_INTERVAL_MS = 500;

interface DeviceNetworkCallOptions {
  operationId?: string;
  presentedGrant?: DeviceConnectionGrant;
}

export interface DesktopExecutionDeviceNetworkPort {
  sendRpc<T>(
    peerId: string,
    method: string,
    parameters: unknown,
    options?: DeviceNetworkCallOptions,
  ): Promise<T>;
  syncWithDevice(
    peerId: string,
    options: { conversationIds: string[]; operationId?: string },
  ): Promise<unknown>;
  abortOperation(operationId: string): Promise<void>;
  finishOperation(operationId: string): Promise<void>;
}

export interface DesktopExecutionLocalPorts {
  executeLocal: RemoteAgentExecutionCoordinatorOptions['executeLocal'];
  retryLocal: RemoteAgentExecutionCoordinatorOptions['retryLocal'];
  deleteLocal: RemoteAgentExecutionCoordinatorOptions['deleteLocal'];
  cancelLocal: RemoteAgentExecutionCoordinatorOptions['cancelLocal'];
}

export interface DesktopExecutionCoordinatorAdapterOptions extends DesktopExecutionLocalPorts {
  localPeerId: string;
  deviceNetwork: DesktopExecutionDeviceNetworkPort;
  createOperationId: () => string;
  createProvenanceId: () => string;
  onWarning?: (message: string, error: unknown) => void;
  pollIntervalMs?: number;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Aborted', 'AbortError');
}

async function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function activeRunKey(
  peerId: string,
  request: Pick<RemoteAgentCancelRequest, 'provenance'>,
): string {
  return JSON.stringify([
    peerId,
    request.provenance.conversationId,
    request.provenance.requestId,
    request.provenance.turnId,
  ]);
}

function digestHex(bytes: Uint8Array): string {
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function stableUploadRequestId(requestId: string, stage: string): Promise<string> {
  const hasher = new Sha256();
  hasher.update(new TextEncoder().encode(`${requestId}\u0000${stage}`));
  return `attachment-${digestHex(await hasher.digest())}`;
}

async function readSourceChunk(
  source: AgentAttachmentUploadSource,
  offset: number,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  signal.throwIfAborted();
  const bytes = await source.readChunk(offset, maximumBytes, { signal });
  signal.throwIfAborted();
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > maximumBytes ||
    offset + bytes.byteLength > source.totalBytes
  ) {
    throw new Error('remote_attachment_source_chunk_invalid');
  }
  return bytes;
}

/** Wrap a browser File as a lazy bounded source; no whole-file buffer crosses the host boundary. */
export function createDesktopFileAttachmentSource(file: File): AgentAttachmentUploadSource {
  return {
    kind: 'source',
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    totalBytes: file.size,
    async readChunk(offset, maximumBytes, readOptions) {
      readOptions?.signal?.throwIfAborted();
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
        throw new Error('desktop_attachment_source_range_invalid');
      }
      if (offset >= file.size) return null;
      const end = Math.min(file.size, offset + maximumBytes);
      const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
      readOptions?.signal?.throwIfAborted();
      return bytes;
    },
  };
}

/**
 * Bind Electron's serializable operation handles and v2 Agent RPC to Core's
 * portable execution coordinator. Operation state and generation fencing stay
 * exclusively in Core; this adapter only translates host calls.
 */
export function createDesktopExecutionCoordinator(
  options: DesktopExecutionCoordinatorAdapterOptions,
): RemoteAgentExecutionCoordinator {
  const clients = new Map<string, ReturnType<typeof createAgentDeviceRpcClient>>();
  const activeRunIds = new Map<string, string>();
  const pollIntervalMs = options.pollIntervalMs ?? REMOTE_RUN_POLL_INTERVAL_MS;

  const withDeviceOperation = async <Result>(
    signal: AbortSignal,
    invoke: (operationId: string) => Promise<Result>,
  ): Promise<Result> => {
    signal.throwIfAborted();
    const operationId = options.createOperationId();
    let abortRequested = false;
    const onAbort = (): void => {
      abortRequested = true;
      void options.deviceNetwork.abortOperation(operationId).catch((error: unknown) => {
        options.onWarning?.('Failed to abort remote Agent operation', error);
      });
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await invoke(operationId);
      signal.throwIfAborted();
      return result;
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (abortRequested) {
        // The abort call and the operation completion can cross on IPC. The
        // main-process generation fence remains authoritative either way.
        await Promise.resolve();
      }
      await options.deviceNetwork.finishOperation(operationId).catch((error: unknown) => {
        options.onWarning?.('Failed to release remote Agent operation', error);
      });
    }
  };

  const clientFor = (peerId: string) => {
    const existing = clients.get(peerId);
    if (existing) return existing;
    const client = createAgentDeviceRpcClient({
      peerId,
      createRequestId: options.createProvenanceId,
      sendRpc: (targetPeerId, method, parameters, callOptions) =>
        withDeviceOperation(
          callOptions?.signal ?? new AbortController().signal,
          operationId =>
            options.deviceNetwork.sendRpc(
              targetPeerId,
              method,
              parameters,
              {
                operationId,
                ...(callOptions?.presentedGrant === undefined
                  ? {}
                  : { presentedGrant: callOptions.presentedGrant }),
              },
            ),
        ),
    });
    clients.set(peerId, client);
    return client;
  };

  const synchronize = (
    peerId: string,
    conversationId: string,
    signal: AbortSignal,
  ): Promise<void> =>
    withDeviceOperation(signal, async operationId => {
      await options.deviceNetwork.syncWithDevice(peerId, {
        conversationIds: [conversationId],
        operationId,
      });
    });

  const waitForRemoteRun = async (
    peerId: string,
    runId: string,
    signal: AbortSignal,
  ): Promise<void> => {
    const client = clientFor(peerId);
    for (;;) {
      signal.throwIfAborted();
      const response = await client.getRunStatus({ runId }, { signal });
      const status = response.status;
      if (!status) throw new Error('remote_agent_run_missing');
      if (status.state === 'completed') return;
      if (status.state === 'failed') {
        throw new Error(status.error?.messageKey ?? 'remote_agent_run_failed');
      }
      if (status.state === 'cancelled') throw new Error('remote_agent_run_cancelled');
      await wait(pollIntervalMs, signal);
    }
  };

  const uploadRemoteAttachment = async (
    peerId: string,
    requestId: string,
    conversationId: string,
    attachment: AgentAttachmentInput | undefined,
    signal: AbortSignal,
  ): Promise<AttachmentReference | undefined> => {
    if (!attachment) return undefined;
    if (attachment.kind === 'committed') return attachment.reference;
    signal.throwIfAborted();
    if (attachment.totalBytes > ATTACHMENT_UPLOAD_LIMITS.totalBytes) {
      throw new Error('remote_attachment_source_too_large');
    }
    const client = clientFor(peerId);
    const begin = await client.beginAttachmentUpload({
      requestId: await stableUploadRequestId(requestId, 'begin'),
      conversationId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      totalBytes: attachment.totalBytes,
    }, { signal });
    const maximumChunkBytes = Math.min(
      begin.maxChunkBytes,
      ATTACHMENT_UPLOAD_LIMITS.chunkBytes,
    );
    const hasher = new Sha256();
    let offset = 0;
    while (offset < attachment.totalBytes) {
      signal.throwIfAborted();
      const bytes = await readSourceChunk(
        attachment,
        offset,
        Math.min(maximumChunkBytes, attachment.totalBytes - offset),
        signal,
      );
      hasher.update(bytes);
      const chunk = await buildAttachmentUploadChunkRequest({
        requestId: await stableUploadRequestId(requestId, `chunk:${offset}`),
        conversationId,
        uploadId: begin.uploadId,
        offset,
        data: bytes,
        includeSha256: true,
      });
      signal.throwIfAborted();
      await client.uploadAttachmentChunk(chunk, { signal });
      offset += bytes.byteLength;
    }
    signal.throwIfAborted();
    const sha256 = `sha256:${digestHex(await hasher.digest())}`;
    if (attachment.sha256 !== undefined && attachment.sha256 !== sha256) {
      throw new Error('remote_attachment_source_digest_mismatch');
    }
    const committed = await client.commitAttachmentUpload({
      requestId: await stableUploadRequestId(requestId, 'commit'),
      conversationId,
      uploadId: begin.uploadId,
      size: attachment.totalBytes,
      sha256,
    }, { signal });
    return committed.attachment;
  };

  const executeRemote = async (
    request: RemoteAgentExecuteRequest,
    callOptions: { signal: AbortSignal },
  ): Promise<RemoteAgentExecutionResult> => {
    if (request.target.kind !== 'remote') throw new Error('remote_execution_target_required');
    const { peerId } = request.target;
    const { provenance } = request;
    // The target must own the same durable conversation snapshot before it
    // starts the turn. Core performs the post-success convergence below.
    await synchronize(peerId, provenance.conversationId, callOptions.signal);
    const attachment = await uploadRemoteAttachment(
      peerId,
      provenance.requestId,
      provenance.conversationId,
      request.attachment,
      callOptions.signal,
    );
    const metadata = request.wikiTiddlers && request.wikiTiddlers.length > 0
      ? { wikiTiddlers: request.wikiTiddlers.map(tiddler => ({ ...tiddler })) }
      : undefined;
    const accepted = await clientFor(peerId).runTurn({
      conversationId: provenance.conversationId,
      definitionId: provenance.definitionId,
      turnId: provenance.turnId,
      requestId: provenance.requestId,
      message: request.message,
      ...(attachment === undefined && metadata === undefined
        ? {}
        : {
          userMessage: {
            content: request.message,
            ...(attachment === undefined ? {} : { attachments: [attachment] }),
            ...(metadata === undefined ? {} : { metadata }),
          },
        }),
    }, { signal: callOptions.signal });
    const key = activeRunKey(peerId, request);
    activeRunIds.set(key, accepted.runId);
    try {
      await waitForRemoteRun(peerId, accepted.runId, callOptions.signal);
      return { runId: accepted.runId };
    } finally {
      if (activeRunIds.get(key) === accepted.runId) {
        activeRunIds.delete(key);
      }
    }
  };

  const retryRemote = async (
    request: RemoteAgentRetryRequest,
    callOptions: { signal: AbortSignal },
  ): Promise<RemoteAgentExecutionResult> => {
    if (request.target.kind !== 'remote') throw new Error('remote_execution_target_required');
    const { peerId } = request.target;
    const { provenance } = request;
    await synchronize(peerId, provenance.conversationId, callOptions.signal);
    const accepted = await clientFor(peerId).retryTurn({
      conversationId: provenance.conversationId,
      definitionId: provenance.definitionId,
      turnId: request.sourceTurnId,
      newTurnId: provenance.turnId,
      requestId: provenance.requestId,
    }, { signal: callOptions.signal });
    const key = activeRunKey(peerId, request);
    activeRunIds.set(key, accepted.runId);
    try {
      await waitForRemoteRun(peerId, accepted.runId, callOptions.signal);
      return { runId: accepted.runId };
    } finally {
      if (activeRunIds.get(key) === accepted.runId) {
        activeRunIds.delete(key);
      }
    }
  };

  const deleteRemote = async (
    request: RemoteAgentDeleteRequest,
    callOptions: { signal: AbortSignal },
  ): Promise<RemoteAgentDeleteResult> => {
    if (request.target.kind !== 'remote') throw new Error('remote_execution_target_required');
    const { peerId } = request.target;
    const { provenance } = request;
    await synchronize(peerId, provenance.conversationId, callOptions.signal);
    await clientFor(peerId).deleteTurn({
      conversationId: provenance.conversationId,
      turnId: provenance.turnId,
      requestId: provenance.requestId,
    }, { signal: callOptions.signal });
    return { ok: true };
  };

  const cancelRemote = async (
    request: RemoteAgentCancelRequest,
    callOptions: { signal: AbortSignal },
  ): Promise<void> => {
    if (request.target.kind !== 'remote') throw new Error('remote_execution_target_required');
    const { peerId } = request.target;
    const key = activeRunKey(peerId, request);
    const runId = activeRunIds.get(key);
    // Pre-sync or attachment upload can be cancelled before a run id exists.
    if (!runId) return;
    try {
      await clientFor(peerId).cancel({ runId }, { signal: callOptions.signal });
    } finally {
      activeRunIds.delete(key);
    }
  };

  return new RemoteAgentExecutionCoordinator({
    localPeerId: options.localPeerId,
    executeLocal: options.executeLocal,
    executeRemote,
    cancelLocal: options.cancelLocal,
    cancelRemote,
    retryLocal: options.retryLocal,
    retryRemote,
    deleteLocal: options.deleteLocal,
    deleteRemote,
    syncConversation: (peerId, conversationId, callOptions) => synchronize(peerId, conversationId, callOptions.signal),
    createId: options.createProvenanceId,
    onListenerError: error => {
      options.onWarning?.('Remote Agent execution listener failed', error);
    },
  });
}
