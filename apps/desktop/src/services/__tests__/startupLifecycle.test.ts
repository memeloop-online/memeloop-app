import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeAgentAndProvider, initializeOptionalAgent, startAppReadyLifecycle } from '../startupLifecycle';

describe('App startup lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('contains an Agent cache schema rejection at the Electron ready boundary', async () => {
    const ready = new EventEmitter();
    const schemaError = new Error(
      'SQLITE_CONSTRAINT: NOT NULL constraint failed: temporary_agent_definitions.systemPrompt',
    );
    const initialize = vi.fn<() => Promise<void>>().mockRejectedValue(schemaError);
    const checkForUpdates = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const onInitializationError = vi.fn();
    const onUpdateError = vi.fn();
    const unhandledRejection = vi.fn();

    process.on('unhandledRejection', unhandledRejection);
    try {
      // This mirrors Electron's EventEmitter contract: the return value from
      // an event listener is ignored, so the listener itself must not be async.
      ready.on('ready', () => {
        startAppReadyLifecycle({
          initialize,
          checkForUpdates,
          onInitializationError,
          onUpdateError,
        });
      });

      expect(ready.emit('ready')).toBe(true);
      await vi.waitFor(() => {
        expect(onInitializationError).toHaveBeenCalledWith(schemaError);
      });

      expect(initialize).toHaveBeenCalledOnce();
      expect(checkForUpdates).not.toHaveBeenCalled();
      expect(onUpdateError).not.toHaveBeenCalled();
      expect(unhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandledRejection);
    }
  });

  it('fails closed when the Agent initializer rejects without affecting the caller', async () => {
    const schemaError = new Error('old Agent cache schema is incompatible');
    const initialize = vi.fn<() => Promise<void>>().mockRejectedValue(schemaError);
    const onError = vi.fn();

    await expect(initializeOptionalAgent(initialize, onError)).resolves.toBe(false);
    expect(onError).toHaveBeenCalledWith(schemaError);
  });

  it('keeps a successful Agent initializer available', async () => {
    const initialize = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const onError = vi.fn();

    await expect(initializeOptionalAgent(initialize, onError)).resolves.toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('lets the host shell continue after an Agent cache failure while retaining provider failures', async () => {
    const schemaError = new Error('old Agent cache schema is incompatible');
    const initializeAgent = vi.fn<() => Promise<void>>().mockRejectedValue(schemaError);
    const initializeProvider = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const onAgentError = vi.fn();

    const agentServicesAvailable = await initializeAgentAndProvider({
      initializeAgent,
      initializeProvider,
      onAgentError,
    });

    expect(agentServicesAvailable).toBe(false);
    expect(initializeProvider).toHaveBeenCalledOnce();
    expect(onAgentError).toHaveBeenCalledWith(schemaError);

    // This is the continuation performed by commonInit after the helper
    // resolves: opening the shell remains possible, but no Agent runtime is
    // supplied to the paired-device network.
    const openShell = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const configureAgentRuntime = vi.fn();
    if (agentServicesAvailable) configureAgentRuntime();
    await openShell();
    expect(openShell).toHaveBeenCalledOnce();
    expect(configureAgentRuntime).not.toHaveBeenCalled();

    const providerError = new Error('external API database unavailable');
    await expect(initializeAgentAndProvider({
      initializeAgent: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      initializeProvider: vi.fn<() => Promise<void>>().mockRejectedValue(providerError),
      onAgentError: vi.fn(),
    })).rejects.toBe(providerError);
  });
});
