import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { logger } from '@services/libs/log';
import { ModelMessage, streamText } from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';

import { getFormattedContent } from '@/pages/ChatTabContent/components/types';
import type { ModelAssignments, ProviderModelRoute } from 'memeloop';
import { MissingAPIKeyError, MissingBaseURLError } from './errors';
import { normalizeOpenAIBaseURL } from './openAIBaseURL';
import type { ProviderRuntimeConfig } from './runtimeTypes';

type AIStreamResult = ReturnType<typeof streamText>;

export function createProviderClient(providerConfig: ProviderRuntimeConfig, provider: string) {
  // 首先检查 providerClass，如果没有则回退到基于名称的判断
  const providerClass = providerConfig.account.providerType || provider;
  const baseURL = providerConfig.account.baseUrl;
  const apiKey = providerConfig.apiKey;

  switch (providerClass) {
    case 'openai':
      return createOpenAI({ apiKey, baseURL: baseURL && normalizeOpenAIBaseURL(baseURL) });
    case 'openAICompatible':
      if (!baseURL) {
        throw new MissingBaseURLError(provider);
      }
      return createOpenAICompatible({
        name: provider,
        apiKey,
        baseURL: normalizeOpenAIBaseURL(baseURL),
      });
    case 'deepseek':
      return createDeepSeek({ apiKey });
    case 'anthropic':
      return createAnthropic({ apiKey });
    case 'ollama':
      if (!baseURL) {
        throw new MissingBaseURLError(provider);
      }
      return createOllama({
        baseURL,
      });
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

export function createProviderModel(providerConfig: ProviderRuntimeConfig, model: ProviderModelRoute) {
  const providerClass = providerConfig.account.providerType || providerConfig.account.providerId;
  if ((providerClass === 'openAICompatible' || providerClass === 'openai') && model.apiMode === 'responses') {
    if (!providerConfig.account.baseUrl && providerClass === 'openAICompatible') {
      throw new MissingBaseURLError(providerConfig.account.providerId);
    }
    return createOpenAI({
      apiKey: providerConfig.apiKey,
      baseURL: providerConfig.account.baseUrl && normalizeOpenAIBaseURL(providerConfig.account.baseUrl),
    }).responses(model.wireModelId);
  }
  return createProviderClient(providerConfig, providerConfig.account.providerId)(model.wireModelId);
}

export function resolveModelGenerationSettings(config: ModelAssignments, model: ProviderModelRoute | undefined): {
  maxOutputTokens?: number;
  topP?: number;
} {
  return {
    maxOutputTokens: config.default?.parameters?.maxOutputTokens ?? model?.requestDefaults?.maxOutputTokens,
    topP: config.default?.parameters?.topP ?? model?.requestDefaults?.topP,
  };
}

export function createProviderStreamOptions(
  config: ModelAssignments,
  messages: Array<ModelMessage>,
  signal: AbortSignal,
  providerConfig: ProviderRuntimeConfig,
) {
  const modelConfig = config.default;
  if (!modelConfig?.modelId) throw new Error('No default model configured');
  const selectedModel = providerConfig.account.models.find(candidate => candidate.modelId === modelConfig.modelId) ?? {
    modelId: modelConfig.modelId,
    wireModelId: modelConfig.modelId,
    apiMode: 'chat-completions' as const,
  };
  const systemMessage = messages.find(message => message.role === 'system');
  const systemPrompt = (systemMessage ? getFormattedContent(systemMessage.content) : undefined) || 'You are a helpful assistant.';
  const nonSystemMessages = messages.filter(message => message.role !== 'system');
  const finalMessages: Array<ModelMessage> = nonSystemMessages.length > 0 ? nonSystemMessages : [{ role: 'user', content: 'Hi' }];
  const { maxOutputTokens, topP } = resolveModelGenerationSettings(config, selectedModel);

  return {
    model: createProviderModel(providerConfig, selectedModel),
    system: systemPrompt,
    messages: finalMessages,
    temperature: config.default?.parameters?.temperature ?? 0.7,
    maxOutputTokens,
    topP,
    abortSignal: signal,
  };
}

export function streamFromProvider(
  config: ModelAssignments,
  messages: Array<ModelMessage>,
  signal: AbortSignal,
  providerConfig?: ProviderRuntimeConfig,
): AIStreamResult {
  // Get default model configuration
  const modelConfig = config.default;
  if (!modelConfig?.providerId || !modelConfig?.modelId) {
    throw new Error('No default model configured');
  }

  const provider = modelConfig.providerId;
  const model = modelConfig.modelId;

  logger.info(`Using AI provider: ${provider}, model: ${model}`);

  try {
    // Check if API key is required
    const isOllama = providerConfig?.account.providerType === 'ollama';
    const isLocalOpenAICompatible = providerConfig?.account.providerType === 'openAICompatible' &&
      providerConfig.account.baseUrl &&
      (providerConfig.account.baseUrl.includes('localhost') || providerConfig.account.baseUrl.includes('127.0.0.1'));

    if (!providerConfig?.apiKey && !isOllama && !isLocalOpenAICompatible) {
      // Ollama and local OpenAI-compatible servers don't require API key
      throw new MissingAPIKeyError(provider);
    }

    return streamText(createProviderStreamOptions(config, messages, signal, providerConfig));
  } catch (error) {
    if (!error) {
      throw new Error(`${provider} error: Unknown error`, { cause: error });
    }
    logger.error(`${provider} streaming error:`, error);
    throw error;
  }
}
