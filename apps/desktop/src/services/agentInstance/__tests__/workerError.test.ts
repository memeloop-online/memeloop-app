import { AgentRunFailure, createMissingApiKeyAgentRunError, extractAgentRunError } from 'memeloop';
import { describe, expect, it } from 'vitest';
import { getWorkerErrorDetails, restoreWorkerError } from '../workerError';

describe('worker error transport', () => {
  it('preserves a typed provider setting error through serialized main-to-worker replies', () => {
    const descriptor = createMissingApiKeyAgentRunError({ providerId: 'provider', diagnosticId: 'missing-key' });
    const reply = JSON.parse(JSON.stringify(getWorkerErrorDetails(new AgentRunFailure(descriptor))));
    expect(extractAgentRunError(restoreWorkerError(reply, 'bridge failure'))).toEqual(descriptor);
  });

  it('retains ordinary error diagnostics without classifying them as configuration errors', () => {
    const original = new Error('ordinary failure');
    const restored = restoreWorkerError(getWorkerErrorDetails(original), 'fallback');
    expect(restored.message).toBe(original.message);
    expect(restored.stack).toBe(original.stack);
    expect(extractAgentRunError(restored)).toBeUndefined();
  });
});
