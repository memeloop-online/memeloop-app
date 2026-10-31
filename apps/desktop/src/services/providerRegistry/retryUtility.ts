/**
 * API Retry Utility
 *
 * Uses the `exponential-backoff` npm package for retry logic with configurable
 * backoff strategy. Designed for AI API calls that may fail transiently.
 */
import { logger } from '@services/libs/log';
import { APICallError } from 'ai';
import { backOff } from 'exponential-backoff';

/**
 * Retry configuration (stored in agent settings / global preferences)
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (0 = no retry) */
  maxAttempts: number;
  /** Initial delay in ms before first retry */
  initialDelayMs: number;
  /** Maximum delay in ms between retries */
  maxDelayMs: number;
  /** Backoff multiplier (2 = exponential doubling) */
  backoffMultiplier: number;
  /** HTTP status codes that should trigger a retry */
  retryableStatusCodes: number[];
}

/** Default retry configuration */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableStatusCodes: [429, 500, 502, 503, 504],
};

/**
 * Check if an error is retryable based on its properties and the retry config.
 */
function isRetryableError(error: unknown, config: RetryConfig): boolean {
  if (!error) return false;

  if (APICallError.isInstance(error)) {
    return error.isRetryable ||
      (typeof error.statusCode === 'number' && config.retryableStatusCodes.includes(error.statusCode));
  }

  const descriptor = typeof error === 'object' && error !== null
    ? Object.getOwnPropertyDescriptor(error, 'code')
    : undefined;
  const code = descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
    ? descriptor.value
    : undefined;
  if (code && ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'].includes(code)) {
    return true;
  }
  return false;
}

/**
 * Extract Retry-After header value from error (in milliseconds).
 */
function getRetryAfterMs(error: unknown): number | undefined {
  const headers = APICallError.isInstance(error) ? error.responseHeaders : undefined;
  if (!headers) return undefined;

  const retryAfter = headers['retry-after'] || headers['Retry-After'];
  if (!retryAfter) return undefined;

  // Could be seconds (number) or HTTP date
  const seconds = Number.parseInt(retryAfter, 10);
  if (!Number.isNaN(seconds)) return seconds * 1000;

  // Try parsing as date
  const date = new Date(retryAfter);
  if (!Number.isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }

  return undefined;
}

/**
 * Execute an async function with exponential backoff retry.
 *
 * @param fn - The async function to execute
 * @param config - Retry configuration
 * @param onRetry - Optional callback invoked before each retry (for UI status updates)
 * @returns The result of fn()
 */
export async function withRetry<T>(
  function_: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  onRetry?: (attempt: number, maxAttempts: number, delayMs: number, error: Error) => void,
): Promise<T> {
  const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

  if (fullConfig.maxAttempts <= 0) {
    // No retry — just execute
    return function_();
  }

  return backOff(function_, {
    numOfAttempts: fullConfig.maxAttempts + 1, // backOff counts the initial attempt
    startingDelay: fullConfig.initialDelayMs,
    maxDelay: fullConfig.maxDelayMs,
    timeMultiple: fullConfig.backoffMultiplier,
    jitter: 'full', // Add jitter to prevent thundering herd
    retry: (error: Error, attemptNumber: number) => {
      const retryable = isRetryableError(error, fullConfig);
      if (!retryable) {
        logger.debug('Error is not retryable, failing immediately', {
          errorName: error.name,
          attempt: attemptNumber,
        });
        return false;
      }

      // Check for Retry-After header
      const retryAfterMs = getRetryAfterMs(error);
      const delayMs = retryAfterMs ?? fullConfig.initialDelayMs * Math.pow(fullConfig.backoffMultiplier, attemptNumber - 1);

      logger.info('Retrying API call', {
        attempt: attemptNumber,
        maxAttempts: fullConfig.maxAttempts,
        delayMs,
        errorName: error.name,
        hasRetryAfter: !!retryAfterMs,
      });

      onRetry?.(attemptNumber, fullConfig.maxAttempts, delayMs, error);
      return true;
    },
  });
}
