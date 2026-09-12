/**
 * Agent CRUD repository.  TypeORM rows are translated to Core contracts only
 * at this persistence boundary; service/UI code never receives SQL-shaped DTOs.
 */
import { backOff } from 'exponential-backoff';
import { Repository } from 'typeorm';

import type { IAgentDefinitionService } from '@services/agentDefinition/interface';
import { AgentInstanceEntity, AgentInstanceMessageEntity } from '@services/database/schema/agent';
import { logger } from '@services/libs/log';
import { materializeAgentInstanceModel } from 'memeloop';

import type { AgentInstance, AgentInstanceMessage, AgentInstanceMetadata } from './interface';
import {
  createAgentInstanceData,
  projectAgentInstanceMetadata,
  projectAgentMessage,
  toDatabaseCompatibleInstance,
  toDatabaseCompatibleMessage,
  toMetadataUpdate,
} from './utilities';

export async function createAgent(
  agentInstanceRepo: Repository<AgentInstanceEntity>,
  agentDefinitionService: IAgentDefinitionService,
  agentDefinitionID?: string,
  options?: { preview?: boolean; volatile?: boolean },
): Promise<AgentInstance> {
  const agentDefinition = await backOff(
    async () => {
      const definition = await agentDefinitionService.getAgentDef(agentDefinitionID);
      if (!definition) throw new Error(`Agent definition not found: ${agentDefinitionID}`);
      return definition;
    },
    { numOfAttempts: 3, startingDelay: 300, timeMultiple: 1.5 },
  );

  const { instanceData, instanceId } = createAgentInstanceData(agentDefinition, options);
  const instanceEntity = agentInstanceRepo.create(toDatabaseCompatibleInstance(instanceData, {
    preview: options?.preview,
  }));
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
  return instanceData;
}

/** Read metadata without joining its potentially large message log. */
export async function getAgentMetadata(
  agentInstanceRepo: Repository<AgentInstanceEntity>,
  agentId: string,
): Promise<AgentInstanceMetadata | undefined> {
  const entity = await agentInstanceRepo.findOne({ where: { id: agentId } });
  return entity ? projectAgentInstanceMetadata(entity) : undefined;
}

export async function updateAgent(
  agentInstanceRepo: Repository<AgentInstanceEntity>,
  agentMessageRepo: Repository<AgentInstanceMessageEntity>,
  agentDefinitionService: IAgentDefinitionService,
  agentId: string,
  data: Partial<AgentInstance>,
): Promise<AgentInstance> {
  const instanceEntity = await agentInstanceRepo.findOne({ where: { id: agentId } });
  if (!instanceEntity) throw new Error(`Agent instance not found: ${agentId}`);

  Object.assign(instanceEntity, toMetadataUpdate(data));
  await agentInstanceRepo.save(instanceEntity);

  const changedMessages: AgentInstanceMessage[] = [];
  if (data.messages) {
    for (const message of data.messages) {
      if (message.conversationId !== agentId) throw new Error('agent_message_conversation_mismatch');
      const existingMessage = await agentMessageRepo.findOne({ where: { id: message.messageId, agentId } });
      if (existingMessage) {
        Object.assign(existingMessage, toDatabaseCompatibleMessage(message));
        changedMessages.push(projectAgentMessage(await agentMessageRepo.save(existingMessage)));
      } else {
        const messageEntity = agentMessageRepo.create(toDatabaseCompatibleMessage(message));
        changedMessages.push(projectAgentMessage(await agentMessageRepo.save(messageEntity)));
      }
    }
  }

  const metadata = projectAgentInstanceMetadata(instanceEntity);
  const definition = await agentDefinitionService.getAgentDef(metadata.agentDefId);
  if (!definition) throw new Error(`Agent definition not found: ${metadata.agentDefId}`);
  return materializeAgentInstanceModel(metadata, definition, changedMessages);
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
): Promise<AgentInstanceMetadata[]> {
  const whereCondition: Record<string, unknown> = { volatile: false };
  if (options?.closed !== undefined) whereCondition.closed = options.closed;
  if (options?.searchName) whereCondition.name = { like: `%${options.searchName}%` };
  const [instances] = await agentInstanceRepo.findAndCount({
    where: Object.keys(whereCondition).length > 0 ? whereCondition : undefined,
    skip: (page - 1) * pageSize,
    take: pageSize,
    order: { created: 'DESC' },
  });
  return instances.map(projectAgentInstanceMetadata);
}
