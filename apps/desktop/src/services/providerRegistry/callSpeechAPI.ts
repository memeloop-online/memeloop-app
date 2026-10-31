import { logger } from '@services/libs/log';

import type { ModelAssignments } from 'memeloop';
import { AuthenticationError } from './errors';
import type { AISpeechResponse } from './interface';
import { resolveProviderTransport } from './providerTransport';
import type { ProviderRuntimeConfig } from './runtimeTypes';

interface SpeechOptions {
  /** Response audio format (mp3, wav, opus, etc.) */
  responseFormat?: string;
  /** Audio sample rate */
  sampleRate?: number;
  /** Speaking speed (0.5 - 2.0) */
  speed?: number;
  /** Audio gain/volume adjustment */
  gain?: number;
  /** Voice identifier (provider-specific) */
  voice?: string;
  /** Whether to stream the response */
  stream?: boolean;
  /** Maximum tokens for generation (for some providers) */
  maxTokens?: number;
}

/**
 * Generate speech from text using an AI provider
 */
export async function generateSpeechFromProvider(
  input: string,
  config: ModelAssignments,
  signal: AbortSignal,
  providerConfig?: ProviderRuntimeConfig,
  options: SpeechOptions = {},
): Promise<AISpeechResponse> {
  // Extract provider and model from config
  // Use speech config if available, fallback to default
  const speechConfig = config.speech || config.default;
  if (!speechConfig) {
    throw new Error('No speech model or default model configured');
  }
  const provider = speechConfig.providerId;
  const model = speechConfig.modelId;

  logger.info(`Using AI speech provider: ${provider}, model: ${model}`);

  try {
    const transport = resolveProviderTransport(providerConfig, provider, 'speech');
    const baseURL = transport.baseURL;
    const headers: Record<string, string> = {
      ...transport.headers,
      'Content-Type': 'application/json',
    };

    // Prepare request body based on provider
    const requestBody: Record<string, unknown> = {
      model,
      input,
    };

    // Add optional parameters
    if (options.responseFormat) {
      requestBody.response_format = options.responseFormat;
    }
    if (options.sampleRate) {
      requestBody.sample_rate = options.sampleRate;
    }
    if (options.speed !== undefined) {
      requestBody.speed = options.speed;
    }
    if (options.gain !== undefined) {
      requestBody.gain = options.gain;
    }
    if (options.voice) {
      requestBody.voice = options.voice;
    }
    if (options.stream !== undefined) {
      requestBody.stream = options.stream;
    }
    if (options.maxTokens) {
      requestBody.max_tokens = options.maxTokens;
    }

    // Make the API call
    const response = await fetch(`${baseURL}/audio/speech`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Speech API error', {
        function: 'generateSpeechFromProvider',
        status: response.status,
        errorText,
      });

      if (response.status === 401) {
        throw new AuthenticationError(provider);
      } else if (response.status === 404) {
        throw new Error(`${provider} error: Model "${model}" not found`);
      } else if (response.status === 429) {
        throw new Error(`${provider} too many requests: Reduce request frequency or check API limits`);
      } else {
        throw new Error(`${provider} speech error: ${errorText}`);
      }
    }

    // Get audio data as ArrayBuffer
    const audioData = await response.arrayBuffer();

    // Determine format from options or content-type
    const format = options.responseFormat || 'mp3';

    return {
      requestId: crypto.randomUUID(),
      audio: audioData,
      format,
      model,
      status: 'done' as const,
    };
  } catch (error) {
    logger.error(`${provider} speech error:`, error);

    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }

    // Return error response for consistency
    return {
      requestId: crypto.randomUUID(),
      audio: new ArrayBuffer(0),
      format: 'mp3',
      model,
      status: 'error' as const,
      errorDetail: {
        name: error instanceof Error ? error.name : 'UnknownError',
        code: 'SPEECH_GENERATION_FAILED',
        provider,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
