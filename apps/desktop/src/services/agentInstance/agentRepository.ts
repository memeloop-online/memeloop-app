/**
 * Agent CRUD Repository — Database operations for AgentInstance lifecycle.
 *
 * Pure functions that receive repositories as parameters.
 * Extracted from AgentInstanceService to reduce class size.
 */
import { backOff } from 'exponential-backoff';
import { pick } from 'lodash';
import { Repository } from 'typeorm';

import type { IAgentDefinitionService } from '@services/agentDefinition/interface';
import { AgentInstanceEntity, AgentInstanceMessageEntity } from '@services/database/schema/agent';
import { logger } from '@services/libs/log';

import type { AgentInstance, AgentInstanceMessage } from './interface';
import { AGENT_INSTANCE_FIELDS, createAgentInstanceData, MESSAGE_FIELDS, toDatabaseCompatibleInstance, toDatabaseCompatibleMessage } from './utilities';

export async function createAgent(
  agentInstanceRepo: Repository<AgentInstanceEntity>,
  agentDefinitionService: IAgentDefinitionService,
  agentDefinitionID?: string,
  options?: { preview?: boolean; volatile?: boolean },
): Promise<AgentInstance> {
  // Get agent definition with exponential backoff to handle initialization race conditions
  const agentDefinition = await backOff(
    async () => {
      const definition = await agentDefinitionService.getAgentDef(agentDefinitionID);
      if (!definition) {
        throw new Error(`Agent definition not found: ${agentDefinitionID}`);
      }
      return definition;
    },
    {
      numOfAttempts: 3,
      startingDelay: 300,
      timeMultiple: 1.5,
    },
  );

  if (!agentDefinition.name) {
    throw new Error(`Agent definition missing required field 'name': ${agentDefinitionID}`);
  }

  const { instanceData, instanceId, now } = createAgentInstanceData(agentDefinition as Required<Pick<typeof agentDefinition, 'name'>> & typeof agentDefinition);

  if (options?.preview || options?.volatile) {
    instanceData.volatile = true;
  }

  const instanceEntity = agentInstanceRepo.create(toDatabaseCompatibleInstance(instanceData));

  // Add timeout to database save operation
  const savePromise = agentInstanceRepo.save(instanceEntity);
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('Database save timeout after 5 seconds'));
    }, 5000);
  });
  await Promise.race([savePromise, timeoutPromise]);

  logger.info('Created agent instance', {
    function: 'createAgent',
    instanceId,
    preview: !!options?.preview,
    volatile: !!options?.volatile || !!options?.preview,
  });

  return { ...instanceData, created: now, modified: now };
}

/** Read agent metadata without joining its potentially very large message log. */
export async function getAgentMetadata(
  agentInstanceRepo: Repository<AgentInstanceEntity>,
  agentId: string,
): Promise<AgentInstance | undefined> {
  const instanceEntity = await agentInstanceRepo.findOne({ where: { id: agentId } });
  if (!instanceEntity) return undefined;
  return { ...pick(instanceEntity, AGENT_INSTANCE_FIELDS), messages: [] };
}

export async function updateAgent(
  agentInstanceRepo: Repository<AgentInstanceEntity>,
  agentMessageRepo: Repository<AgentInstanceMessageEntity>,
  agentId: string,
  data: Partial<AgentInstance>,
): Promise<AgentInstance> {
  const instanceEntity = await agentInstanceRepo.findOne({
    where: { id: agentId },
  });

  if (!instanceEntity) {
    throw new Error(`Agent instance not found: ${agentId}`);
  }

  const pickedProperties = pick(data, ['name', 'status', 'avatarUrl', 'aiApiConfig', 'closed', 'agentFrameworkConfig']);
  Object.assign(instanceEntity, pickedProperties);
  await agentInstanceRepo.save(instanceEntity);

  // Handle message updates if provided
  const changedMessages: AgentInstanceMessageEntity[] = [];
  if (data.messages && data.messages.length > 0) {
    for (const message of data.messages) {
      const existingMessage = await agentMessageRepo.findOne({ where: { id: message.id, agentId } });
      if (existingMessage) {
        existingMessage.content = message.content;
        existingMessage.modified = message.modified || new Date();
        if (message.metadata) existingMessage.metadata = message.metadata;
        if (message.contentType) existingMessage.contentType = message.contentType;
        existingMessage.originNodeId = message.originNodeId ?? existingMessage.originNodeId;
        existingMessage.lamportClock = message.lamportClock ?? existingMessage.lamportClock;
        existingMessage.originSequence = message.originSequence ?? existingMessage.originSequence;
        existingMessage.turnId = message.turnId ?? existingMessage.turnId;
        await agentMessageRepo.save(existingMessage);
        changedMessages.push(existingMessage);
      } else {
        const messageData = pick(message, MESSAGE_FIELDS) as AgentInstanceMessage;
        const messageEntity = agentMessageRepo.create(toDatabaseCompatibleMessage(messageData));
        changedMessages.push(await agentMessageRepo.save(messageEntity));
      }
    }
  }

  return { ...pick(instanceEntity, AGENT_INSTANCE_FIELDS), messages: changedMessages };
}

export async function deleteAgent(
  agentInstanceRepo: Repository<AgentInstanceEntity>,
  agentMessageRepo: Repository<AgentInstanceMessageEntity>,
  agentId: string,
): Promise<void> {
  await agentMessageRepo.delete({ agentId });
  await agentInstanceRepo.delete(agentId);
  logger.info(`Deleted agent instance: ${agentId}`);
}

export async function getAgents(
  agentInstanceRepo: Repository<AgentInstanceEntity>,
  page: number,
  pageSize: number,
  options?: { closed?: boolean; searchName?: string },
): Promise<Omit<AgentInstance, 'messages'>[]> {
  const skip = (page - 1) * pageSize;
  const take = pageSize;

  const whereCondition: Record<string, unknown> = {};
  whereCondition.volatile = false;

  if (options?.closed !== undefined) {
    whereCondition.closed = options.closed;
  }
  if (options?.searchName) {
    whereCondition.name = { like: `%${options.searchName}%` };
  }

  const [instances, _] = await agentInstanceRepo.findAndCount({
    where: Object.keys(whereCondition).length > 0 ? whereCondition : undefined,
    skip,
    take,
    order: { created: 'DESC' },
  });

  return instances.map(entity => pick(entity, AGENT_INSTANCE_FIELDS));
}
