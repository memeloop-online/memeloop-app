import { APICallError, LoadAPIKeyError, NoSuchModelError } from 'ai';

import { isProviderConfigError } from './errors';

export interface StructuredProviderErrorDetail {
  name: string;
  code: string;
  provider: string;
}

/**
 * Convert only explicit provider/configuration error metadata into a stable
 * code. Raw exception messages and response bodies are diagnostics, not a UI
 * or persistence contract, so this function never parses or returns them.
 */
export function extractErrorDetails(error: unknown, provider: string): StructuredProviderErrorDetail {
  if (isProviderConfigError(error)) {
    return {
      name: error.name,
      code: error.code,
      provider: error.provider,
    };
  }

  if (LoadAPIKeyError.isInstance(error)) {
    return { name: 'MissingAPIKeyError', code: 'MISSING_API_KEY', provider };
  }

  if (NoSuchModelError.isInstance(error)) {
    return { name: 'ModelNotFoundError', code: 'MODEL_NOT_FOUND', provider };
  }

  if (APICallError.isInstance(error)) {
    switch (error.statusCode) {
      case 401:
      case 403: {
        return { name: 'AuthenticationError', code: 'AUTHENTICATION_FAILED', provider };
      }
      case 404: {
        return { name: 'ModelNotFoundError', code: 'MODEL_NOT_FOUND', provider };
      }
      case 429: {
        return { name: 'RateLimitError', code: 'RATE_LIMIT_EXCEEDED', provider };
      }
      default: {
        return {
          name: 'AIProviderError',
          code: typeof error.statusCode === 'number' && error.statusCode >= 500
            ? 'PROVIDER_UNAVAILABLE'
            : 'PROVIDER_REQUEST_FAILED',
          provider,
        };
      }
    }
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return { name: 'AbortError', code: 'CANCELLED', provider };
  }

  return { name: 'AIProviderError', code: 'UNKNOWN_ERROR', provider };
}
