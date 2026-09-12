import {
  type AgentFrameworkConfig,
  type PromptNode,
  type PromptPluginConfig,
  type PromptPreviewClient,
  PromptPreviewController,
  type PromptPreviewPreparedExecution,
} from 'memeloop';
import { nanoid } from 'nanoid';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPromptRole(value: unknown): value is NonNullable<PromptNode['role']> {
  return value === 'system' || value === 'user' || value === 'assistant' || value === 'tool';
}

function isPromptNode(value: unknown): value is PromptNode {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0) return false;
  if (value.text !== undefined && typeof value.text !== 'string') return false;
  if (value.caption !== undefined && typeof value.caption !== 'string') return false;
  if (value.role !== undefined && !isPromptRole(value.role)) return false;
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return false;
  if (value.dynamicPosition !== undefined && value.dynamicPosition !== 'deferToEnd') return false;
  return value.children === undefined || isArrayOf(value.children, isPromptNode);
}

function isPromptPluginConfig(value: unknown): value is PromptPluginConfig {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.toolId === 'string' && value.toolId.length > 0;
}

function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(guard);
}

/** Validate and adapt the desktop schema result to Core's required preview shape. */
export function toCoreAgentFrameworkConfig(
  config: AgentFrameworkConfig,
): AgentFrameworkConfig {
  if (!isArrayOf(config.prompts, isPromptNode) || !isArrayOf(config.plugins, isPromptPluginConfig)) {
    throw new Error('prompt_preview_framework_config_invalid');
  }
  return {
    prompts: config.prompts,
    plugins: config.plugins,
    ...(Array.isArray(config.response) ? { response: config.response } : {}),
  };
}

const previewClient: PromptPreviewClient = {
  async generatePreview(_config, execution, onProgress, options) {
    options.signal.throwIfAborted();
    onProgress?.({ progress: 0.5, stepCode: 'finalize' });
    const result = {
      flatPrompts: execution.initialPage.items.map(item => ({
        role: item.role,
        content: item.preview,
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
