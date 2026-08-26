import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';

import { extractErrorDetails } from '../errorHandlers';
import { MissingAPIKeyError } from '../errors';

function apiError(statusCode: number): APICallError {
  return new APICallError({
    message: 'sensitive upstream response',
    url: 'https://provider.invalid/v1/chat',
    requestBodyValues: { apiKey: 'must-not-escape' },
    statusCode,
    responseBody: 'sensitive body',
  });
}

describe('structured provider error classification', () => {
  it('uses explicit configuration codes without returning human messages', () => {
    expect(extractErrorDetails(new MissingAPIKeyError('siliconflow'), 'ignored')).toEqual({
      name: 'MissingAPIKeyError',
      code: 'MISSING_API_KEY',
      provider: 'siliconflow',
    });
  });

  it.each([
    [401, 'AUTHENTICATION_FAILED'],
    [404, 'MODEL_NOT_FOUND'],
    [429, 'RATE_LIMIT_EXCEEDED'],
    [503, 'PROVIDER_UNAVAILABLE'],
  ])('maps HTTP %s structurally to %s', (status, code) => {
    const detail = extractErrorDetails(apiError(status), 'provider');
    expect(detail).toEqual(expect.objectContaining({ code, provider: 'provider' }));
    expect(detail).not.toHaveProperty('message');
    expect(JSON.stringify(detail)).not.toContain('sensitive');
  });

  it('does not infer a contract from arbitrary English text', () => {
    expect(extractErrorDetails(new Error('API key not found 401 429'), 'provider')).toEqual({
      name: 'AIProviderError',
      code: 'UNKNOWN_ERROR',
      provider: 'provider',
    });
  });
});
