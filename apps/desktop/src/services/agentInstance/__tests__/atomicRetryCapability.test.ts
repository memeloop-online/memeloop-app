/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';

import { MemoryAgentRunStateStore } from 'memeloop';
import { requireDesktopAtomicRetryStore } from '../atomicRetryCapability';

describe('Desktop atomic retry capability gate', () => {
  it('stops and rejects a stale CLI runtime before exposing its storage', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);

    await expect(requireDesktopAtomicRetryStore({
      storage: new MemoryAgentRunStateStore(),
      stop,
    })).rejects.toThrow('atomic agent retry capability is unavailable');

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('accepts the single combined storage without stopping its runtime', async () => {
    const storage = Object.assign(new MemoryAgentRunStateStore(), {
      retryTurnAtomic: vi.fn(),
    });
    const stop = vi.fn().mockResolvedValue(undefined);

    await expect(requireDesktopAtomicRetryStore({ storage, stop })).resolves.toBe(storage);
    expect(stop).not.toHaveBeenCalled();
  });

  it('reports cleanup failure as the cause of the fail-closed startup error', async () => {
    const cleanupFailure = new Error('close failed');

    await expect(requireDesktopAtomicRetryStore({
      storage: {},
      stop: vi.fn().mockRejectedValue(cleanupFailure),
    })).rejects.toMatchObject({ cause: cleanupFailure });
  });
});
