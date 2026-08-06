import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { logger } from '@services/libs/log';
import { ModelMessage, streamText } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';

import { getFormattedContent } from '@/pages/ChatTabContent/components/types';
import { AiAPIConfig } from '@services/agentInstance/promptConcat/promptConcatSchema';
import { AuthenticationError, MissingAPIKeyError, MissingBaseURLError, parseProviderError } from './errors';
import type { AIProviderConfig, ModelInfo } from './interface';
import { normalizeOpenAIBaseURL } from './openAIBaseURL';

type AIStreamResult = ReturnType<typeof streamText>;

export function createProviderClient(providerConfig: { provider: string; providerClass?: string; baseURL?: string }, apiKey?: string) {
  // 首先检查 providerClass，如果没有则回退到基于名称的判断
  const providerClass = providerConfig.providerClass || providerConfig.provider;

  switch (providerClass) {
    case 'openai':
      return createOpenAI({ apiKey, baseURL: providerConfig.baseURL && normalizeOpenAIBaseURL(providerConfig.baseURL) });
    case 'openAICompatible':
      if (!providerConfig.baseURL) {
        throw new MissingBaseURLError(providerConfig.provider);
      }
      return createOpenAICompatible({
        name: providerConfig.provider,
        apiKey,
        baseURL: normalizeOpenAIBaseURL(providerConfig.baseURL),
      });
    case 'deepseek':
      return createDeepSeek({ apiKey });
    case 'anthropic':
      return createAnthropic({ apiKey });
    case 'ollama':
      if (!providerConfig.baseURL) {
        throw new MissingBaseURLError(providerConfig.provider);
      }
      return createOllama({
        baseURL: providerConfig.baseURL,
      });
    default:
      throw new Error(`Unsupported AI provider: ${providerConfig.provider}`);
  }
}

export function createProviderModel(providerConfig: AIProviderConfig, model: ModelInfo) {
  const providerClass = providerConfig.providerClass || providerConfig.provider;
  if ((providerClass === 'openAICompatible' || providerClass === 'openai') && model.apiMode === 'responses') {
    if (!providerConfig.baseURL && providerClass === 'openAICompatible') {
      throw new MissingBaseURLError(providerConfig.provider);
    }
    return createOpenAI({
      apiKey: providerConfig.apiKey,
      baseURL: providerConfig.baseURL && normalizeOpenAIBaseURL(providerConfig.baseURL),
    }).responses(model.name);
  }
  return createProviderClient(providerConfig, providerConfig.apiKey)(model.name);
}

export function streamFromProvider(
  config: AiAPIConfig,
  messages: Array<ModelMessage>,
  signal: AbortSignal,
  providerConfig?: AIProviderConfig,
): AIStreamResult {
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
    // Check if API key is required
    const isOllama = providerConfig?.providerClass === 'ollama';
    const isLocalOpenAICompatible = providerConfig?.providerClass === 'openAICompatible' &&
      providerConfig?.baseURL &&
      (providerConfig.baseURL.includes('localhost') || providerConfig.baseURL.includes('127.0.0.1'));

    if (!providerConfig?.apiKey && !isOllama && !isLocalOpenAICompatible) {
      // Ollama and local OpenAI-compatible servers don't require API key
      throw new MissingAPIKeyError(provider);
    }

    const selectedModel = providerConfig.models.find(candidate => candidate.name === model) ?? { name: model };

    // Extract system message from messages if present
    const systemMessage = messages.find(message => message.role === 'system');
    const systemPrompt = (systemMessage ? getFormattedContent(systemMessage.content) : undefined) || 'You are a helpful assistant.';

    // Filter out system messages from the messages array since we're handling them separately
    const nonSystemMessages = messages.filter(message => message.role !== 'system');

    // Ensure we have at least one message to avoid AI library errors
    const finalMessages: Array<ModelMessage> = nonSystemMessages.length > 0 ? nonSystemMessages : [{ role: 'user' as const, content: 'Hi' }];

    const providerModel = createProviderModel(providerConfig, selectedModel);
    return streamText({
      model: providerModel,
      system: systemPrompt,
      messages: finalMessages,
      temperature,
      abortSignal: signal,
    });
  } catch (error) {
    if (!error) {
      throw new Error(`${provider} error: Unknown error`, { cause: error });
    } else if ((error as Error).message.includes('401')) {
      throw new AuthenticationError(provider);
    } else if ((error as Error).message.includes('404')) {
      throw new Error(`${provider} error: Model "${model}" not found`, { cause: error });
    } else if ((error as Error).message.includes('429')) {
      throw new Error(`${provider} too many requests: Reduce request frequency or check API limits`, { cause: error });
    } else {
      logger.error(`${provider} streaming error:`, error);
      // Try to parse the error into a more specific type if possible
      throw parseProviderError(error as Error, provider);
    }
  }
}
