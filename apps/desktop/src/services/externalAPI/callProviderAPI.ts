import type { AiAPIConfig } from '@services/agentInstance/promptConcat/promptConcatSchema/types';
import { logger } from '@services/libs/log';
import type { ILLMProvider, PortableLlmMessage, PortableLlmStreamPart } from 'memeloop';

import { createLLMProvider, type LLMProviderId } from 'memeloop/llm-providers';
import type { ModelMessage } from './interface';

import { AuthenticationError, MissingAPIKeyError, MissingBaseURLError, parseProviderError } from './errors';
import type { AIProviderConfig } from './interface';

function toPortableMessages(messages: readonly ModelMessage[]): PortableLlmMessage[] {
  return messages.map((message, index): PortableLlmMessage => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: message.toolCallId || `legacy-tool-result-${index}`,
          toolName: 'legacy-tool',
          output: { type: 'text', value: message.content },
        }],
      };
    }
    if (typeof message.content === 'string') return message as PortableLlmMessage;
    const textParts = message.content.map(part => ({
      type: 'text' as const,
      text: part.text ?? part.content ?? '',
    }));
    if (message.role === 'system') {
      return { role: 'system', content: textParts.map(part => part.text).join('\n') };
    }
    return { role: message.role, content: textParts };
  });
}

async function* textOnlyStream(
  result: string | PortableLlmStreamPart | AsyncIterable<PortableLlmStreamPart>,
): AsyncGenerator<string> {
  if (typeof result === 'string') {
    yield result;
    return;
  }
  if (Symbol.asyncIterator in result) {
    for await (const part of result) {
      if (part.type === 'text-delta') yield part.text;
    }
    return;
  }
  if (result.type === 'text-delta') yield result.text;
}

/**
 * Map Desktop's AIProviderConfig to a memeloop core ILLMProvider.
 *
 * Core owns the provider dispatch; Desktop only translates its own config
 * schema (providerClass, models array, apiKey, baseURL) into the core shape.
 */
export async function createProviderFromConfig(providerConfig: AIProviderConfig): Promise<ILLMProvider> {
  const providerClass = providerConfig.providerClass || providerConfig.provider;
  const isOllama = providerClass === 'ollama';
  const isLocalOpenAICompatible = providerClass === 'openAICompatible' &&
    providerConfig.baseURL &&
    (providerConfig.baseURL.includes('localhost') || providerConfig.baseURL.includes('127.0.0.1'));

  if (!providerConfig.apiKey && !isOllama && !isLocalOpenAICompatible) {
    throw new MissingAPIKeyError(providerConfig.provider);
  }

  if ((isOllama || providerClass === 'openAICompatible') && !providerConfig.baseURL) {
    throw new MissingBaseURLError(providerConfig.provider);
  }

  // Pick the first model as the default model id for core provider creation.
  const firstModel = providerConfig.models?.[0];

  return createLLMProvider({
    provider: (providerClass === 'openAICompatible' ? 'openai' : providerClass) as LLMProviderId,
    name: providerConfig.provider,
    apiKey: providerConfig.apiKey,
    baseUrl: providerConfig.baseURL,
    model: firstModel?.name,
    options: firstModel?.parameters,
  });
}

export async function streamFromProvider(
  config: AiAPIConfig,
  messages: Array<ModelMessage>,
  signal: AbortSignal,
  providerConfig?: AIProviderConfig,
): Promise<AsyncIterable<string>> {
  // Get default model configuration
  const modelConfig = config.default;
  if (!modelConfig?.provider || !modelConfig?.model) {
    throw new Error('No default model configured');
  }

  const provider = modelConfig.provider;
  const model = modelConfig.model;
  const modelParameters = config.modelParameters || {};
  const { temperature = 0.7 } = modelParameters;

  logger.info(`Using AI provider: ${provider}, model: ${model}`);

  try {
    if (!providerConfig) {
      throw new Error(`Provider configuration not found: ${provider}`);
    }

    const llmProvider = await createProviderFromConfig(providerConfig);

    // Pass memeloop's messages directly. The core has already built the correct
    // prompt structure (including agent-specific system prompts and tool
    // descriptions); merging system messages here can leak host-only tools
    // into the first system prompt and break per-agent prompt isolation.
    const chatResult = await llmProvider.chat({
      providerId: provider,
      modelId: model,
      logicalModelId: model,
      wireModelId: model,
      apiMode: 'chat-completions',
      messages: toPortableMessages(messages),
      stream: true,
      temperature,
      signal,
    });

    return textOnlyStream(chatResult);
  } catch (error) {
    const cause = error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : 'Unknown provider error');
    if (!error) {
      throw new Error(`${provider} error: Unknown error`, { cause: error });
    } else if (cause.message.includes('401')) {
      throw new AuthenticationError(provider);
    } else if (cause.message.includes('404')) {
      throw new Error(`${provider} error: Model "${model}" not found`, { cause: error });
    } else if (cause.message.includes('429')) {
      throw new Error(`${provider} too many requests: Reduce request frequency or check API limits`, { cause: error });
    } else {
      logger.error(`${provider} streaming error:`, error);
      throw parseProviderError(cause, provider);
    }
  }
}
