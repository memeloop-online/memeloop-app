import { APICallError } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import { withRetry } from '../retryUtility';

function apiError(statusCode: number, responseHeaders?: Record<string, string>): APICallError {
  return new APICallError({
    message: 'raw upstream detail',
    url: 'https://provider.invalid/v1/chat',
    requestBodyValues: {},
    statusCode,
    responseHeaders,
    isRetryable: statusCode >= 500,
  });
}

describe('provider retry policy', () => {
  it('retries structured retryable HTTP failures', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(apiError(503))
      .mockResolvedValue('ok');

    await expect(withRetry(operation, {
      maxAttempts: 1,
      initialDelayMs: 1,
      maxDelayMs: 1,
      backoffMultiplier: 1,
    })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry arbitrary English text that resembles a status', async () => {
    const failure = new Error('rate limit 429 too many requests');
    const operation = vi.fn().mockRejectedValue(failure);

    await expect(withRetry(operation, {
      maxAttempts: 2,
      initialDelayMs: 1,
      maxDelayMs: 1,
      backoffMultiplier: 1,
    })).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
