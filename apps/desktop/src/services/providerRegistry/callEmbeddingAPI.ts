import { logger } from '@services/libs/log';

import type { ModelAssignments } from 'memeloop';
import { AuthenticationError } from './errors';
import type { AIEmbeddingResponse } from './interface';
import { providerClass, resolveProviderTransport } from './providerTransport';
import type { ProviderRuntimeConfig } from './runtimeTypes';

interface EmbeddingAPIResponse {
  data?: Array<{ embedding: number[] }>;
  object?: string;
  usage?: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

interface EmbeddingOptions {
  /** Dimensions for the embedding (supported by some providers) */
  dimensions?: number;
  /** Encoding format for the embedding */
  encoding_format?: 'float' | 'base64';
}

/**
 * Generate embeddings from an AI provider
 */
export async function generateEmbeddingsFromProvider(
  inputs: string[],
  config: ModelAssignments,
  signal: AbortSignal,
  providerConfig?: ProviderRuntimeConfig,
  options: EmbeddingOptions = {},
): Promise<AIEmbeddingResponse> {
  // Extract provider and model from config
  // Use embedding config if available, fallback to default
  const embeddingConfig = config.embedding || config.default;
  if (!embeddingConfig) {
    throw new Error('No embedding model or default model configured');
  }
  const provider = embeddingConfig.providerId;
  const model = embeddingConfig.modelId;

  logger.info(`Using AI embedding provider: ${provider}, model: ${model}`);

  try {
    const transport = resolveProviderTransport(providerConfig, provider, 'embedding');
    const baseURL = transport.baseURL;
    const headers: Record<string, string> = {
      ...transport.headers,
      'Content-Type': 'application/json',
    };

    // Prepare request body
    const requestBody: Record<string, unknown> = {
      model,
      input: inputs,
    };

    // Add optional parameters based on provider support
    if (options.dimensions && (providerClass(providerConfig, provider) === 'openAICompatible' || provider === 'siliconflow')) {
      requestBody.dimensions = options.dimensions;
    }

    if (options.encoding_format) {
      requestBody.encoding_format = options.encoding_format;
    }

    // Make the API call
    const response = await fetch(`${baseURL}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Embedding API error', {
        function: 'generateEmbeddingsFromProvider',
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
        throw new Error(`${provider} embedding error: ${errorText}`);
      }
    }

    const data = await response.json() as EmbeddingAPIResponse;

    // Transform the response to our standard format
    const embeddings = data.data?.map(item => item.embedding) || [];

    return {
      requestId: crypto.randomUUID(),
      embeddings,
      model,
      object: data.object || 'list',
      usage: data.usage,
      status: 'done' as const,
    };
  } catch (error) {
    logger.error(`${provider} embedding error:`, error);

    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }

    // Return error response for consistency
    return {
      requestId: crypto.randomUUID(),
      embeddings: [],
      model,
      object: 'error',
      status: 'error' as const,
      errorDetail: {
        name: error instanceof Error ? error.name : 'UnknownError',
        code: 'EMBEDDING_FAILED',
        provider,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
