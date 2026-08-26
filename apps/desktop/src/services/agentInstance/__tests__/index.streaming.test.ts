/**
 * Agent observable serialization-boundary tests.
 *
 * Model streaming itself is owned by the UtilityProcess/Core integration and
 * is covered in memeloopWorkerIntegration.test.ts. These tests guard the IPC
 * contract so a long conversation cannot be cloned on every live update.
 */
import { nanoid } from 'nanoid';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IAgentDefinitionService } from '@services/agentDefinition/interface';
import type { AgentInstance, AgentInstanceMessage, AgentInstanceUpdate, IAgentInstanceService } from '@services/agentInstance/interface';
import { container } from '@services/container';
import type { IDatabaseService } from '@services/database/interface';
import serviceIdentifier from '@services/serviceIdentifier';

describe('AgentInstanceService incremental observable', () => {
  let service: IAgentInstanceService;
  let agent: AgentInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    const repository = {
      findOne: vi.fn(),
      save: vi.fn(),
      create: vi.fn((value: unknown) => value),
      find: vi.fn().mockResolvedValue([]),
      findAndCount: vi.fn().mockResolvedValue([[], 0]),
    };
    const dataSource = {
      isInitialized: true,
      initialize: vi.fn(),
      destroy: vi.fn(),
      getRepository: vi.fn().mockReturnValue(repository),
      manager: {
        transaction: vi.fn(async (callback: (manager: { getRepository: () => typeof repository }) => unknown) => callback({ getRepository: () => repository })),
      },
    };
    const database = container.get<IDatabaseService>(serviceIdentifier.Database);
    database.getDatabase = vi.fn().mockResolvedValue(dataSource);
    const definitions = container.get<IAgentDefinitionService>(serviceIdentifier.AgentDefinition);
    definitions.getAgentDef = vi.fn().mockResolvedValue(undefined);

    service = container.get<IAgentInstanceService>(serviceIdentifier.AgentInstance);
    await service.initialize();
    agent = {
      id: nanoid(),
      agentDefId: 'general-assistant',
      name: 'Long conversation',
      status: { state: 'working', modified: new Date() },
      created: new Date(),
      closed: false,
      messages: [],
    };
  });

  it('does not read or serialize history for the initial subscription', async () => {
    const hugeMetadataInput: AgentInstance = {
      ...agent,
      messages: Array.from({ length: 100_000 }, (_, index) => ({
        id: `historical-${index}`,
        agentId: agent.id,
        role: 'user' as const,
        content: 'x'.repeat(128),
      })),
    };
    vi.spyOn(service, 'getAgentMetadata').mockResolvedValue(hugeMetadataInput);
    const pageReader = vi.spyOn(service, 'getAgentMessagePage');

    const update = await nextDefinedUpdate(service, agent.id);

    expect(pageReader).not.toHaveBeenCalled();
    expect(update).not.toHaveProperty('messages');
    expect(update.message).toBeUndefined();
    expect(JSON.stringify(update).length).toBeLessThan(16_384);
  });

  it('publishes at most one changed message instead of a resident tail', async () => {
    vi.spyOn(service, 'getAgentMetadata').mockResolvedValue(agent);
    const first = await nextDefinedUpdate(service, agent.id);
    expect(first.message).toBeUndefined();

    const changedMessage: AgentInstanceMessage = {
      id: 'turn-100000',
      agentId: agent.id,
      role: 'assistant',
      content: 'bounded delta',
    };
    const next = new Promise<AgentInstanceUpdate>((resolve) => {
      const subscription = service.subscribeToAgentUpdates(agent.id).subscribe(update => {
        if (!update?.message) return;
        subscription.unsubscribe();
        resolve(update);
      });
    });

    const notify = (service as unknown as {
      notifyAgentUpdate(agentId: string, value: AgentInstance, message?: AgentInstanceMessage): void;
    }).notifyAgentUpdate.bind(service);
    notify(agent.id, {
      ...agent,
      messages: Array.from({ length: 100_000 }, (_, index) => ({
        id: `historical-${index}`,
        agentId: agent.id,
        role: 'user' as const,
        content: 'never serialized',
      })),
    }, changedMessage);

    await expect(next).resolves.toMatchObject({
      agent: { id: agent.id },
      message: changedMessage,
    });
  });
});

async function nextDefinedUpdate(
  service: IAgentInstanceService,
  agentId: string,
): Promise<AgentInstanceUpdate> {
  return new Promise((resolve, reject) => {
    const subscription = service.subscribeToAgentUpdates(agentId).subscribe({
      next: update => {
        if (!update) return;
        subscription.unsubscribe();
        resolve(update);
      },
      error: reject,
    });
  });
}
