import { type PromptPreviewClient, PromptPreviewController, type PromptPreviewPreparedExecution } from 'memeloop';
import { nanoid } from 'nanoid';

const previewClient: PromptPreviewClient = {
  async generatePreview(_config, execution, onProgress, options) {
    options.signal.throwIfAborted();
    onProgress?.({ progress: 0.5, stepCode: 'finalize' });
    const result = {
      flatPrompts: execution.initialPage.items.map(item => ({
        role: item.role,
        content: item.preview,
        entryId: item.entryId,
        entryIndex: item.entryIndex,
      })),
      processedPrompts: [],
    };
    options.signal.throwIfAborted();
    return result;
  },
  async getAuditPage(request, options) {
    options.signal.throwIfAborted();
    const page = await window.service.agentInstance.getPromptPreviewAuditPage(request);
    options.signal.throwIfAborted();
    return page;
  },
  async getAuditDetail(request, options) {
    options.signal.throwIfAborted();
    const detail = await window.service.agentInstance.getPromptPreviewAuditDetail(request);
    options.signal.throwIfAborted();
    return detail;
  },
  releaseAuditSession(request) {
    return window.service.agentInstance.releasePromptPreviewAuditSession(request);
  },
};

async function prepareExecution(
  conversationId: string,
  inputText: string | undefined,
  signal: AbortSignal,
): Promise<PromptPreviewPreparedExecution> {
  const requestId = nanoid();
  const cancel = () => {
    void window.service.agentInstance.cancelPromptPreview(requestId);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    const result = await window.service.agentInstance.preparePromptPreviewExecution({
      conversationId,
      requestId,
      ...(inputText === undefined ? {} : { inputText }),
    });
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

export function createDesktopPromptPreviewController(): PromptPreviewController {
  return new PromptPreviewController({
    previewClient,
    prepareExecutionModelRequest: (conversationId, _config, options) => prepareExecution(conversationId, options.inputText, options.signal),
  });
}
