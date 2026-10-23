import { AgentDefinitionService } from '@services/agentDefinition';
import type { IDatabaseService } from '@services/database/interface';
import { logger } from '@services/libs/log';
import { initializeAgentAndProvider } from '@services/startupLifecycle';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('AgentDefinitionService startup', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not report the Agent database as initialized when schema setup rejects', async () => {
    const schemaError = new Error(
      'SQLITE_CONSTRAINT: NOT NULL constraint failed: temporary_agent_definitions.systemPrompt',
    );
    const service = new AgentDefinitionService();
    const serviceWithPrivateFields = service as unknown as {
      databaseService: IDatabaseService;
    };
    serviceWithPrivateFields.databaseService = {
      initializeDatabase: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      getDatabase: vi.fn().mockRejectedValue(schemaError),
    } as unknown as IDatabaseService;

    const initializeProvider = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const onAgentError = vi.fn();
    await expect(initializeAgentAndProvider({
      initializeAgent: () => service.initialize(),
      initializeProvider,
      onAgentError,
    })).resolves.toBe(false);
    expect(initializeProvider).toHaveBeenCalledOnce();
    expect(onAgentError).toHaveBeenCalledWith(schemaError);
    expect(logger.debug).not.toHaveBeenCalledWith('Agent database initialized');
    expect(service.getInitializationStatus()).toEqual({
      state: 'unavailable',
      recoveryRequired: true,
    });
  });
});
