import { act, renderHook, waitFor } from '@testing-library/react';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useExecutionTargets } from '../useExecutionTargets';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const conversationId = 'conversation-1';
const definitionId = 'definition-1';

function terminalStatus(parameters: Record<string, unknown>) {
  return {
    runId: parameters.runId,
    requestId: 'request-remote',
    turnId: 'turn-remote',
    conversationId,
    definitionId,
    requestPeerId: 'peer-local',
    payloadDigest: 'digest-remote',
    state: 'completed' as const,
    acceptedAt: 1,
    updatedAt: 2,
  };
}

describe('useExecutionTargets', () => {
  const service = window.service as unknown as Record<string, unknown>;
  const observables = window.observables as unknown as Record<string, unknown>;
  let previousAgentService: unknown;
  let previousDeviceService: unknown;
  let previousDeviceObservable: unknown;

  beforeEach(() => {
    previousAgentService = service.agentInstance;
    previousDeviceService = service.deviceNetwork;
    previousDeviceObservable = observables.deviceNetwork;
  });

  afterEach(() => {
    service.agentInstance = previousAgentService;
    service.deviceNetwork = previousDeviceService;
    observables.deviceNetwork = previousDeviceObservable;
    vi.restoreAllMocks();
  });

  function installHost() {
    const syncWithDevice = vi.fn().mockResolvedValue(undefined);
    const sendRpc = vi.fn(async (
      _peerId: string,
      method: string,
      parameters: Record<string, unknown>,
    ) => {
      if (method === 'memeloop.agent.runTurn') {
        return {
          ok: true,
          state: 'accepted',
          runId: 'remote-run',
          requestId: parameters.requestId,
          turnId: parameters.turnId,
          conversationId: parameters.conversationId,
        };
      }
      if (method === 'memeloop.agent.getRunStatus') {
        return { status: terminalStatus(parameters) };
      }
      if (method === 'memeloop.agent.cancel') return { ok: true, status: null };
      if (method === 'memeloop.chat.beginAttachmentUpload') {
        return {
          ok: true,
          requestId: parameters.requestId,
          conversationId: parameters.conversationId,
          uploadId: 'remote-upload-1',
          totalBytes: parameters.totalBytes,
          maxChunkBytes: 256 * 1024,
        };
      }
      if (method === 'memeloop.chat.uploadAttachmentChunk') {
        return {
          ok: true,
          requestId: parameters.requestId,
          conversationId: parameters.conversationId,
          uploadId: parameters.uploadId,
          offset: parameters.offset,
          byteLength: parameters.byteLength,
        };
      }
      if (method === 'memeloop.chat.commitAttachmentUpload') {
        return {
          ok: true,
          requestId: parameters.requestId,
          conversationId: parameters.conversationId,
          uploadId: parameters.uploadId,
          attachment: {
            contentHash: parameters.sha256,
            filename: 'x.txt',
            mimeType: 'application/octet-stream',
            size: parameters.size,
          },
        };
      }
      throw new Error(`unexpected_rpc:${method}`);
    });
    service.deviceNetwork = {
      start: vi.fn().mockResolvedValue(undefined),
      getLocalDevice: vi.fn().mockResolvedValue({ peerId: 'peer-local' }),
      listDevices: vi.fn().mockResolvedValue([{
        peerId: 'peer-remote',
        displayName: 'Remote Mac',
        platform: 'desktop',
        trusted: true,
        capabilities: { agentLoop: true },
        reachability: { state: 'online', paths: [] },
      }]),
      sendRpc,
      syncWithDevice,
      abortOperation: vi.fn().mockResolvedValue(undefined),
      finishOperation: vi.fn().mockResolvedValue(undefined),
    };
    const executeAgentTurn = vi.fn(async request => ({
      ok: true,
      state: 'accepted',
      runId: 'local-run',
      requestId: request.requestId,
      turnId: request.turnId,
      conversationId: request.conversationId,
    }));
    const retryAgentTurnAndWait = vi.fn(async request => ({
      ok: true,
      state: 'accepted',
      runId: 'local-retry',
      requestId: request.requestId,
      turnId: request.newTurnId,
      conversationId: request.conversationId,
    }));
    service.agentInstance = {
      executeAgentTurn,
      retryAgentTurnAndWait,
      deleteAgentTurn: vi.fn().mockResolvedValue({ ok: true }),
      cancelAgent: vi.fn().mockResolvedValue(undefined),
      beginAgentAttachmentUpload: vi.fn(async request => ({
        ok: true,
        requestId: request.requestId,
        conversationId: request.conversationId,
        uploadId: 'upload-1',
        totalBytes: request.totalBytes,
        maxChunkBytes: 256 * 1024,
      })),
      uploadAgentAttachmentChunk: vi.fn(async request => ({
        ok: true,
        requestId: request.requestId,
        conversationId: request.conversationId,
        uploadId: request.uploadId,
        offset: request.offset,
        byteLength: request.byteLength,
      })),
      commitAgentAttachmentUpload: vi.fn(async request => ({
        ok: true,
        requestId: request.requestId,
        conversationId: request.conversationId,
        uploadId: request.uploadId,
        attachment: {
          contentHash: request.sha256,
          filename: 'note.txt',
          mimeType: 'text/plain',
          size: request.size,
        },
      })),
    };
    observables.deviceNetwork = { devices$: new Subject() };
    return {
      executeAgentTurn,
      retryAgentTurnAndWait,
      sendRpc,
      syncWithDevice,
    };
  }

  function renderExecutionTargets(refreshAgent = vi.fn().mockResolvedValue(undefined)) {
    return renderHook(() =>
      useExecutionTargets({
        agent: { id: conversationId, agentDefId: definitionId },
        orderedMessages: [],
        refreshAgent,
      })
    );
  }

  it('routes a remote turn with explicit provenance, terminal wait, and scoped convergence', async () => {
    const { sendRpc, syncWithDevice } = installHost();
    const refreshAgent = vi.fn().mockResolvedValue(undefined);
    const { result } = renderExecutionTargets(refreshAgent);

    await waitFor(() => {
      expect(result.current.executionTargets).toHaveLength(2);
    });
    await act(async () => result.current.setExecutionTarget('peer:peer-remote'));
    await act(async () => result.current.sendMessage('hello'));

    const runCall = sendRpc.mock.calls.find((call: unknown[]) => call[1] === 'memeloop.agent.runTurn');
    expect(runCall?.[2]).toMatchObject({
      conversationId,
      definitionId,
      message: 'hello',
      requestId: expect.any(String),
      turnId: expect.any(String),
    });
    expect(Object.keys(runCall?.[2] as object)).not.toContain('messages');
    expect(sendRpc.mock.calls.some((call: unknown[]) => call[1] === 'memeloop.agent.getRunStatus')).toBe(true);
    expect(syncWithDevice).toHaveBeenCalledTimes(2);
    for (const call of syncWithDevice.mock.calls) {
      expect(call[0]).toBe('peer-remote');
      expect(call[1]).toMatchObject({
        conversationIds: [conversationId],
        operationId: expect.any(String),
      });
    }
    expect(refreshAgent).toHaveBeenCalledOnce();
    expect(result.current.executionSnapshot).toMatchObject({
      conversationId,
      status: 'succeeded',
      executionPeerId: 'peer-remote',
      operation: 'execute',
      provenance: {
        conversationId,
        definitionId,
        requestId: expect.any(String),
        turnId: expect.any(String),
      },
      synchronization: 'synchronized',
    });
  });

  it('routes local execute, retry, delete, and cancel through the four terminal host ports', async () => {
    const { executeAgentTurn, retryAgentTurnAndWait, sendRpc, syncWithDevice } = installHost();
    const { result } = renderExecutionTargets();
    await waitFor(() => {
      expect(result.current.executionSnapshot?.target).toEqual({ kind: 'local' });
    });

    await act(async () => result.current.sendMessage('local'));
    expect(executeAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      conversationId,
      definitionId,
      message: 'local',
      requestId: expect.any(String),
      turnId: expect.any(String),
    }));

    await act(async () => result.current.retrySelectedTurn('source-turn'));
    expect(retryAgentTurnAndWait).toHaveBeenCalledWith(expect.objectContaining({
      conversationId,
      definitionId,
      turnId: 'source-turn',
      newTurnId: expect.any(String),
      requestId: expect.any(String),
    }));

    await act(async () => result.current.deleteSelectedTurn('delete-turn'));
    expect((service.agentInstance as { deleteAgentTurn: ReturnType<typeof vi.fn> }).deleteAgentTurn)
      .toHaveBeenCalledWith(expect.objectContaining({
        conversationId,
        turnId: 'delete-turn',
        requestId: expect.any(String),
      }));

    await act(async () => result.current.cancelSelectedTarget());
    expect((service.agentInstance as { cancelAgent: ReturnType<typeof vi.fn> }).cancelAgent)
      .toHaveBeenCalledWith(conversationId);
    expect(sendRpc).not.toHaveBeenCalled();
    expect(syncWithDevice).not.toHaveBeenCalled();
  });

  it('uploads a local file first and carries its committed reference through the coordinator port', async () => {
    const { executeAgentTurn } = installHost();
    const { result } = renderExecutionTargets();
    await waitFor(() => {
      expect(result.current.executionSnapshot?.target).toEqual({ kind: 'local' });
    });

    await act(async () =>
      result.current.sendMessage(
        'with attachment',
        new File(['hello'], 'note.txt', { type: 'text/plain' }),
      )
    );

    expect(executeAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      userMessage: {
        content: 'with attachment',
        attachments: [expect.objectContaining({ filename: 'note.txt', size: 5 })],
      },
    }));
  });

  it('streams a remote attachment before dispatching the turn', async () => {
    const { sendRpc, syncWithDevice } = installHost();
    const { result } = renderExecutionTargets();
    await waitFor(() => {
      expect(result.current.executionTargets).toHaveLength(2);
    });
    await act(async () => result.current.setExecutionTarget('peer:peer-remote'));

    await act(async () =>
      result.current.sendMessage(
        'attachment',
        new File(['x'], 'x.txt'),
      )
    );

    const methods = sendRpc.mock.calls.map(call => call[1]);
    expect(methods).toContain('memeloop.chat.beginAttachmentUpload');
    expect(methods).toContain('memeloop.chat.uploadAttachmentChunk');
    expect(methods).toContain('memeloop.chat.commitAttachmentUpload');
    const runCall = sendRpc.mock.calls.find(call => call[1] === 'memeloop.agent.runTurn');
    expect(runCall?.[2]).toMatchObject({
      userMessage: {
        content: 'attachment',
        attachments: [{
          contentHash: expect.stringMatching(/^sha256:[\da-f]{64}$/u),
          filename: 'x.txt',
          size: 1,
        }],
      },
    });
    expect(syncWithDevice).toHaveBeenCalledTimes(2);
  });

  it('fences a late local IPC completion when the conversation binding is disposed', async () => {
    const { executeAgentTurn } = installHost();
    let resolveExecution!: () => void;
    executeAgentTurn.mockImplementation(request =>
      new Promise(resolve => {
        resolveExecution = () => {
          resolve({
            ok: true,
            state: 'accepted',
            runId: 'late-local-run',
            requestId: request.requestId,
            turnId: request.turnId,
            conversationId: request.conversationId,
          });
        };
      })
    );
    const { result, unmount } = renderExecutionTargets();
    await waitFor(() => {
      expect(result.current.executionSnapshot?.target).toEqual({ kind: 'local' });
    });

    let execution!: Promise<void>;
    act(() => {
      execution = result.current.sendMessage('pending');
    });
    const observed = execution.catch((error: unknown) => error);
    await waitFor(() => {
      expect(result.current.executionSnapshot?.status).toBe('running');
    });
    unmount();

    await expect(observed).resolves.toMatchObject({ code: 'CANCELLED' });
    resolveExecution();
    await Promise.resolve();
  });
});
