import { logger } from '@services/libs/log';

import type { ModelAssignments } from 'memeloop';
import { AuthenticationError } from './errors';
import type { AITranscriptionResponse } from './interface';
import { resolveProviderTransport } from './providerTransport';
import type { ProviderRuntimeConfig } from './runtimeTypes';

interface TranscriptionOptions {
  /** Language of the audio (ISO-639-1 format, e.g., 'en', 'zh') */
  language?: string;
  /** Response format (json, text, srt, vtt, verbose_json) */
  responseFormat?: string;
  /** Temperature for sampling (0-1) */
  temperature?: number;
  /** Optional prompt to guide the model */
  prompt?: string;
}

/**
 * Transcribe audio to text using an AI provider
 */
export async function generateTranscriptionFromProvider(
  audioFile: File | Blob,
  config: ModelAssignments,
  signal: AbortSignal,
  providerConfig?: ProviderRuntimeConfig,
  options: TranscriptionOptions = {},
): Promise<AITranscriptionResponse> {
  // Extract provider and model from config
  // Use transcriptions config if available, fallback to default
  const transcriptionsConfig = config.transcriptions || config.default;
  if (!transcriptionsConfig) {
    throw new Error('No transcriptions model or default model configured');
  }
  const provider = transcriptionsConfig.providerId;
  const model = transcriptionsConfig.modelId;

  logger.info(`Using AI transcription provider: ${provider}, model: ${model}`);

  try {
    const transport = resolveProviderTransport(providerConfig, provider, 'transcription');
    const baseURL = transport.baseURL;
    const headers: Record<string, string> = { ...transport.headers };

    // Prepare FormData for multipart/form-data request
    const formData = new FormData();
    formData.append('file', audioFile);
    formData.append('model', model);

    // Add optional parameters
    if (options.language) {
      formData.append('language', options.language);
    }
    if (options.responseFormat) {
      formData.append('response_format', options.responseFormat);
    }
    if (options.temperature !== undefined) {
      formData.append('temperature', options.temperature.toString());
    }
    if (options.prompt) {
      formData.append('prompt', options.prompt);
    }

    // Make the API call
    const response = await fetch(`${baseURL}/audio/transcriptions`, {
      method: 'POST',
      headers,
      body: formData,
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Transcription API error', {
        function: 'generateTranscriptionFromProvider',
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
        throw new Error(`${provider} transcription error: ${errorText}`);
      }
    }

    // Parse response based on format
    const responseFormat = options.responseFormat || 'json';
    let text = '';
    let language: string | undefined;
    let duration: number | undefined;

    if (responseFormat === 'json' || responseFormat === 'verbose_json') {
      const data = await response.json() as {
        text: string;
        language?: string;
        duration?: number;
      };
      text = data.text;
      language = data.language;
      duration = data.duration;
    } else {
      // For text, srt, vtt formats, just get the text
      text = await response.text();
    }

    return {
      requestId: crypto.randomUUID(),
      text,
      language,
      duration,
      model,
      status: 'done' as const,
    };
  } catch (error) {
    logger.error(`${provider} transcription error:`, error);

    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }

    // Return error response for consistency
    return {
      requestId: crypto.randomUUID(),
      text: '',
      model,
      status: 'error' as const,
      errorDetail: {
        name: error instanceof Error ? error.name : 'UnknownError',
        code: 'TRANSCRIPTION_FAILED',
        provider,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
