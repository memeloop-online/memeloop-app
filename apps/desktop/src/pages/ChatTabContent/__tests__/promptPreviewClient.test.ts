import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDesktopPromptPreviewController } from '../promptPreviewClient';

function execution() {
  return {
    sessionId: 'preview-session',
    revision: 'preview-revision',
    route: {
      providerId: 'provider',
      logicalModelId: 'logical-model',
      wireModelId: 'wire-model',
      apiMode: 'responses' as const,
    },
    contextStats: { messageCount: 200_000, compactionSummaryCount: 4 },
    initialPage: {
      sessionId: 'preview-session',
      revision: 'preview-revision',
      items: [{
        entryId: 'message-199999',
        entryIndex: 199_999,
        role: 'user' as const,
        source: 'conversation-message' as const,
        preview: 'bounded preview',
        canonicalBytes: 2_000_000,
      }],
      totalEntries: 200_000,
      previousCursor: 'previous',
      hasMoreBefore: true,
      hasMoreAfter: false,
      sampled: true,
    },
  };
}

describe('desktop retained prompt preview client', () => {
  const service = window.service as unknown as Record<string, unknown>;
  let previous: unknown;
  let agentInstance: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    previous = service.agentInstance;
    agentInstance = {
      preparePromptPreviewExecution: vi.fn(async () => execution()),
      getPromptPreviewAuditPage: vi.fn(async request => ({
        sessionId: request.sessionId,
        revision: request.expectedRevision,
        items: [],
        totalEntries: 200_000,
        previousCursor: 'previous-2',
        nextCursor: 'next-2',
        hasMoreBefore: true,
        hasMoreAfter: true,
        sampled: false,
      })),
      getPromptPreviewAuditDetail: vi.fn(async request => ({
        sessionId: request.sessionId,
        revision: request.expectedRevision,
        target: request.target,
        canonicalUtf8: Uint8Array.from([123, 34, 114, 111, 108, 101, 34, 58, 34, 117, 115, 101, 114, 34, 125]),
        complete: true,
      })),
      releasePromptPreviewAuditSession: vi.fn(async () => undefined),
      cancelPromptPreview: vi.fn(async () => undefined),
    };
    service.agentInstance = agentInstance;
  });

  afterEach(() => {
    service.agentInstance = previous;
    vi.restoreAllMocks();
  });

  it('moves only an opaque bounded audit descriptor across renderer IPC', async () => {
    const controller = createDesktopPromptPreviewController();
    controller.open();
    const result = await controller.generate(
      { prompts: [], plugins: [] },
      'conversation-100k',
      'continue',
    );

    expect(agentInstance.preparePromptPreviewExecution).toHaveBeenCalledWith({
      conversationId: 'conversation-100k',
      requestId: expect.any(String),
      inputText: 'continue',
    });
    const prepareRequest = agentInstance.preparePromptPreviewExecution.mock.calls[0]?.[0];
    expect(prepareRequest).not.toHaveProperty('messages');
    expect(prepareRequest).not.toHaveProperty('modelRequest');
    expect(result).not.toHaveProperty('messages');
    expect(result).not.toHaveProperty('modelRequest');
    expect(result?.audit.initialPage.items).toHaveLength(1);

    await controller.getAuditPage({
      sessionId: 'preview-session',
      expectedRevision: 'preview-revision',
      mode: 'before',
      cursor: 'previous',
      limit: 50,
      maxBytes: 256 * 1024,
    });
    await controller.getAuditDetail({
      sessionId: 'preview-session',
      expectedRevision: 'preview-revision',
      target: { kind: 'entry', entryId: 'message-199999', entryIndex: 199_999 },
      maxBytes: 256 * 1024,
    });
    expect(agentInstance.getPromptPreviewAuditPage).toHaveBeenCalledTimes(1);
    expect(agentInstance.getPromptPreviewAuditDetail).toHaveBeenCalledTimes(1);

    controller.close();
    expect(agentInstance.releasePromptPreviewAuditSession).toHaveBeenCalledWith({
      sessionId: 'preview-session',
      expectedRevision: 'preview-revision',
    });
  });

  it('cancels a worker preparation when the preview closes', async () => {
    agentInstance.preparePromptPreviewExecution.mockImplementation(() => new Promise(() => undefined));
    const controller = createDesktopPromptPreviewController();
    controller.open();
    void controller.generate({ prompts: [], plugins: [] }, 'conversation-cancel');
    await vi.waitFor(() => {
      expect(agentInstance.preparePromptPreviewExecution).toHaveBeenCalledTimes(1);
    });
    const requestId = agentInstance.preparePromptPreviewExecution.mock.calls[0]?.[0].requestId;
    controller.close();
    await vi.waitFor(() => {
      expect(agentInstance.cancelPromptPreview).toHaveBeenCalledWith(requestId);
    });
  });
});
