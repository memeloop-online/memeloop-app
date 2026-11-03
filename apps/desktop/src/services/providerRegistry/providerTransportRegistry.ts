import { ModelMessage } from 'ai';
import { nanoid } from 'nanoid';
import { defer, from, Observable } from 'rxjs';
import { filter, finalize, startWith } from 'rxjs/operators';

import { logger } from '@services/libs/log';
import type { ModelAssignments } from 'memeloop';

import { AccountStore } from './accountStore';
import { generateEmbeddingsFromProvider } from './callEmbeddingAPI';
import { generateImageFromProvider } from './callImageGenerationAPI';
import { resolveModelGenerationSettings, streamFromProvider } from './callProviderAPI';
import { generateSpeechFromProvider } from './callSpeechAPI';
import { generateTranscriptionFromProvider } from './callTranscriptionsAPI';
import { extractErrorDetails } from './errorHandlers';
import type { AIEmbeddingResponse, AIImageGenerationResponse, AISpeechResponse, AIStreamResponse, AITranscriptionResponse } from './interface';
import { ApiCallLogger, RequestLifecycle } from './requestLifecycle';
import { DEFAULT_RETRY_CONFIG, withRetry } from './retryUtility';
import { modelSupportsVision } from './runtimeTypes';

interface AIRequestContext {
  requestId: string;
  controller: AbortController;
}

function formatMessageContentForDebug(content: ModelMessage['content'] | undefined): string {
  if (content === undefined || typeof content === 'string') return content ?? '';
  if (!Array.isArray(content)) return '';
  return content.map(part => {
    if (typeof part === 'string') return part;
    if ('type' in part && part.type === 'text' && 'text' in part) return typeof part.text === 'string' ? part.text : '';
    if ('content' in part && typeof part.content === 'string') return part.content;
    return '';
  }).join('');
}

function truncateDebugPreview(content: string, maxLength = 200): string {
  return content.length <= maxLength ? content : content.slice(0, maxLength) + '…';
}

/** Provider transport and modality orchestration; no settings persistence or IPC concerns. */
export class ProviderTransportRegistry {
  constructor(
    private readonly accountStore: AccountStore,
    private readonly requestLifecycle: RequestLifecycle,
    private readonly apiLogger: ApiCallLogger,
  ) {}

  private prepareRequest(): AIRequestContext {
    const requestId = nanoid();
    return { requestId, controller: this.requestLifecycle.prepare(requestId) };
  }

  streamFromAI(
    messages: Array<ModelMessage>,
    config: ModelAssignments,
    options?: { agentInstanceId?: string; awaitLogs?: boolean },
  ): Observable<AIStreamResponse> {
    return defer(() => {
      const { requestId, controller } = this.prepareRequest();
      return from(this.generateFromAI(messages, config, options, { requestId, controller })).pipe(
        filter((response, index) => !(index === 0 && response.status === 'start')),
        startWith({ requestId, content: '', status: 'start' as const }),
        finalize(() => {
          if (this.requestLifecycle.has(requestId)) {
            controller.abort();
            this.requestLifecycle.cleanup(requestId);
            logger.debug(`[${requestId}] Cleaned up in streamFromAI finalize`);
          }
        }),
      );
    });
  }

  async *generateFromAI(
    messages: Array<ModelMessage>,
    config: ModelAssignments,
    options?: { agentInstanceId?: string; awaitLogs?: boolean },
    request?: AIRequestContext,
  ): AsyncGenerator<AIStreamResponse, void, unknown> {
    const { requestId, controller } = request ?? this.prepareRequest();
    const modelConfig = config.default;
    if (!modelConfig?.providerId || !modelConfig.modelId) {
      yield {
        requestId,
        content: 'Chat.ConfigError.NoDefaultModel',
        status: 'error',
        errorDetail: {
          name: 'MissingConfigError',
          code: 'NO_DEFAULT_MODEL',
          provider: 'unknown',
          message: 'Chat.ConfigError.NoDefaultModel',
        },
      };
      this.requestLifecycle.cleanup(requestId);
      return;
    }

    const selectedModel = this.accountStore.getSelectedModel(config);
    const generationSettings = resolveModelGenerationSettings(config, selectedModel);
    const requestMetadata = {
      provider: modelConfig.providerId,
      model: modelConfig.modelId,
      messageCount: messages.length,
      hasImageContent: messages.some(message =>
        Array.isArray(message.content) &&
        message.content.some(part => typeof part === 'object' && part !== null && 'type' in part && part.type === 'image')
      ),
      configSummary: {
        messageRoles: messages.map(message => message.role),
        systemPromptPreview: truncateDebugPreview(
          formatMessageContentForDebug(messages.find(message => message.role === 'system')?.content),
        ),
        latestUserPromptPreview: truncateDebugPreview(
          formatMessageContentForDebug([...messages].reverse().find(message => message.role === 'user')?.content),
        ),
        temperature: config.default?.parameters?.temperature ?? 0.7,
        ...generationSettings,
      },
    };
    const messagesForLog = messages.map(message => {
      if (!Array.isArray(message.content)) return message;
      return {
        ...message,
        content: message.content.map(part => {
          if (typeof part === 'object' && part !== null && 'type' in part && part.type === 'image' && 'image' in part) {
            const image = part.image as Buffer | Uint8Array;
            return { type: 'image', imageSize: image.length, imageFormat: 'buffer' };
          }
          return part;
        }),
      };
    });
    const logStart = () =>
      this.apiLogger.log(requestId, 'streaming', 'start', {
        agentInstanceId: options?.agentInstanceId,
        requestMetadata,
        requestPayload: { messages: messagesForLog, config },
      });
    if (options?.awaitLogs) await logStart();
    else void logStart();

    try {
      yield { requestId, content: '', status: 'start' };
      const provider = this.accountStore.getProvider(modelConfig.providerId);
      if (!provider) {
        const errorDetail = {
          name: 'MissingProviderError',
          code: 'PROVIDER_NOT_FOUND',
          provider: modelConfig.providerId,
          message: 'Chat.ConfigError.ProviderNotFound',
        };
        const log = this.apiLogger.log(requestId, 'streaming', 'error', { errorDetail });
        if (options?.awaitLogs) await log;
        else void log;
        yield { requestId, content: 'Chat.ConfigError.ProviderNotFound', status: 'error', errorDetail };
        return;
      }
      const hasImageContent = requestMetadata.hasImageContent;
      if (hasImageContent && !modelSupportsVision(provider.account, modelConfig.modelId)) {
        const errorDetail = {
          name: 'UnsupportedFeatureError',
          code: 'MODEL_NO_VISION_SUPPORT',
          provider: modelConfig.providerId,
          message: 'Chat.ConfigError.ModelNoVisionSupport',
          params: { model: modelConfig.modelId },
        };
        const log = this.apiLogger.log(requestId, 'streaming', 'error', { errorDetail });
        if (options?.awaitLogs) await log;
        else void log;
        yield { requestId, content: 'Chat.ConfigError.ModelNoVisionSupport', status: 'error', errorDetail };
        return;
      }

      let result: ReturnType<typeof streamFromProvider>;
      try {
        result = await withRetry(
          async () => streamFromProvider(config, messages, controller.signal, provider),
          DEFAULT_RETRY_CONFIG,
          (attempt, maxAttempts, delayMs) => logger.info('Retrying AI stream creation', { requestId, attempt, maxAttempts, delayMs }),
        );
      } catch (error) {
        const errorDetail = extractErrorDetails(error, modelConfig.providerId);
        const log = this.apiLogger.log(requestId, 'streaming', 'error', { errorDetail });
        if (options?.awaitLogs) await log;
        else void log;
        yield { requestId, content: errorDetail.code, status: 'error', errorDetail };
        return;
      }

      let fullResponse = '';
      const startTime = Date.now();
      for await (const chunk of result.textStream) {
        fullResponse += chunk;
        if (controller.signal.aborted) {
          void this.apiLogger.log(requestId, 'streaming', 'cancel', { responseContent: fullResponse });
          yield { requestId, content: 'Request cancelled', status: 'error' };
          return;
        }
        yield { requestId, content: fullResponse, status: 'update' };
      }
      void this.apiLogger.log(requestId, 'streaming', 'done', {
        responseContent: fullResponse,
        responseMetadata: { duration: Date.now() - startTime, responseLength: fullResponse.length },
      });
      yield { requestId, content: fullResponse, status: 'done' };
    } catch (error) {
      const errorDetail = extractErrorDetails(error, modelConfig.providerId);
      const log = this.apiLogger.log(requestId, 'streaming', 'error', { errorDetail });
      if (options?.awaitLogs) await log;
      else void log;
      yield { requestId, content: errorDetail.code, status: 'error', errorDetail };
    } finally {
      this.requestLifecycle.cleanup(requestId);
    }
  }

  async generateEmbeddings(
    inputs: string[],
    config: ModelAssignments,
    options?: { dimensions?: number; encoding_format?: 'float' | 'base64' },
  ): Promise<AIEmbeddingResponse> {
    const { requestId, controller } = this.prepareRequest();
    const modelConfig = config.embedding ?? config.default;
    if (!modelConfig?.providerId || !modelConfig?.modelId) {
      this.requestLifecycle.cleanup(requestId);
      return {
        requestId,
        embeddings: [],
        model: 'unknown',
        object: 'error',
        status: 'error',
        errorDetail: {
          name: 'MissingConfigError',
          code: 'NO_EMBEDDING_MODEL',
          provider: 'unknown',
        },
      };
    }
    try {
      const providerConfig = this.accountStore.getProvider(modelConfig.providerId);
      if (!providerConfig) throw new Error(`Provider not found: ${modelConfig.providerId}`);
      return await generateEmbeddingsFromProvider(
        inputs,
        config,
        controller.signal,
        providerConfig,
        options,
      );
    } catch (error) {
      return {
        requestId,
        embeddings: [],
        model: modelConfig.modelId,
        object: 'error',
        status: 'error',
        errorDetail: extractErrorDetails(error, modelConfig.providerId),
      };
    } finally {
      this.requestLifecycle.cleanup(requestId);
    }
  }

  async generateSpeech(
    input: string,
    config: ModelAssignments,
    options?: {
      responseFormat?: string;
      sampleRate?: number;
      speed?: number;
      gain?: number;
      voice?: string;
      stream?: boolean;
      maxTokens?: number;
    },
  ): Promise<AISpeechResponse> {
    const { requestId, controller } = this.prepareRequest();
    const modelConfig = config.speech ?? config.default;
    if (!modelConfig?.providerId || !modelConfig?.modelId) {
      this.requestLifecycle.cleanup(requestId);
      return {
        requestId,
        audio: new ArrayBuffer(0),
        format: 'mp3',
        model: 'unknown',
        status: 'error',
        errorDetail: {
          name: 'MissingConfigError',
          code: 'NO_SPEECH_MODEL',
          provider: 'unknown',
        },
      };
    }
    try {
      const providerConfig = this.accountStore.getProvider(modelConfig.providerId);
      if (!providerConfig) throw new Error(`Provider not found: ${modelConfig.providerId}`);
      return await generateSpeechFromProvider(
        input,
        config,
        controller.signal,
        providerConfig,
        options,
      );
    } catch (error) {
      return {
        requestId,
        audio: new ArrayBuffer(0),
        format: 'mp3',
        model: modelConfig.modelId,
        status: 'error',
        errorDetail: extractErrorDetails(error, modelConfig.providerId),
      };
    } finally {
      this.requestLifecycle.cleanup(requestId);
    }
  }

  async generateTranscription(
    audioFile: File | Blob,
    config: ModelAssignments,
    options?: {
      language?: string;
      responseFormat?: string;
      temperature?: number;
      prompt?: string;
    },
  ): Promise<AITranscriptionResponse> {
    const { requestId, controller } = this.prepareRequest();
    const modelConfig = config.transcriptions ?? config.default;
    if (!modelConfig?.providerId || !modelConfig?.modelId) {
      this.requestLifecycle.cleanup(requestId);
      return {
        requestId,
        text: '',
        model: 'unknown',
        status: 'error',
        errorDetail: {
          name: 'MissingConfigError',
          code: 'NO_TRANSCRIPTIONS_MODEL',
          provider: 'unknown',
        },
      };
    }
    try {
      const providerConfig = this.accountStore.getProvider(modelConfig.providerId);
      if (!providerConfig) throw new Error(`Provider not found: ${modelConfig.providerId}`);
      return await generateTranscriptionFromProvider(
        audioFile,
        config,
        controller.signal,
        providerConfig,
        options,
      );
    } catch (error) {
      return {
        requestId,
        text: '',
        model: modelConfig.modelId,
        status: 'error',
        errorDetail: extractErrorDetails(error, modelConfig.providerId),
      };
    } finally {
      this.requestLifecycle.cleanup(requestId);
    }
  }

  async generateImage(
    prompt: string,
    config: ModelAssignments,
    options?: { numImages?: number; width?: number; height?: number },
  ): Promise<AIImageGenerationResponse> {
    const { requestId, controller } = this.prepareRequest();
    const modelConfig = config.imageGeneration ?? config.default;
    if (!modelConfig?.providerId || !modelConfig?.modelId) {
      this.requestLifecycle.cleanup(requestId);
      return {
        requestId,
        images: [],
        model: 'unknown',
        status: 'error',
        errorDetail: {
          name: 'MissingConfigError',
          code: 'NO_IMAGE_GENERATION_MODEL',
          provider: 'unknown',
        },
      };
    }
    try {
      const providerConfig = this.accountStore.getProvider(modelConfig.providerId);
      if (!providerConfig) throw new Error(`Provider not found: ${modelConfig.providerId}`);
      return await generateImageFromProvider(
        prompt,
        config,
        controller.signal,
        providerConfig,
        options,
      );
    } catch (error) {
      return {
        requestId,
        images: [],
        model: modelConfig.modelId,
        status: 'error',
        errorDetail: extractErrorDetails(error, modelConfig.providerId),
      };
    } finally {
      this.requestLifecycle.cleanup(requestId);
    }
  }
}
