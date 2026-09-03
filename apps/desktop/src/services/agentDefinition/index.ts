import { inject, injectable } from 'inversify';
import type { AgentDefinition } from 'memeloop';
import { nanoid } from 'nanoid';
import { DataSource, Repository } from 'typeorm';

import type { IAgentBrowserService } from '@services/agentBrowser/interface';
import type { IAgentInstanceService } from '@services/agentInstance/interface';
import { container } from '@services/container';
import type { IDatabaseService } from '@services/database/interface';
import { AgentDefinitionEntity } from '@services/database/schema/agent';
import { logger } from '@services/libs/log';
import serviceIdentifier from '@services/serviceIdentifier';
import { DEFAULT_AGENT_DEFINITION_ID, getOfficialAgentDefinitions } from './builtinAgentDefinitions';
import type { IAgentDefinitionService } from './interface';

/** Map the physical TypeORM row to Core's portable definition exactly once. */
function isDefined<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

function entityToAgentDefinition(entity: AgentDefinitionEntity): AgentDefinition {
  return {
    id: entity.id,
    name: entity.name,
    description: entity.description,
    systemPrompt: entity.systemPrompt,
    tools: [...entity.tools],
    version: entity.version,
    ...(isDefined(entity.modelConfig) ? { modelConfig: entity.modelConfig } : {}),
    ...(isDefined(entity.promptSchema) ? { promptSchema: entity.promptSchema } : {}),
    ...(isDefined(entity.agentFrameworkConfig) ? { agentFrameworkConfig: entity.agentFrameworkConfig } : {}),
    ...(isDefined(entity.agentTools) ? { agentTools: entity.agentTools } : {}),
    ...(isDefined(entity.avatarUrl) ? { avatarUrl: entity.avatarUrl } : {}),
    ...(isDefined(entity.agentFrameworkID) ? { agentFrameworkID: entity.agentFrameworkID } : {}),
    ...(isDefined(entity.heartbeat) ? { heartbeat: entity.heartbeat } : {}),
  };
}

function agentDefinitionToEntity(definition: AgentDefinition): Partial<AgentDefinitionEntity> {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    systemPrompt: definition.systemPrompt,
    tools: [...definition.tools],
    version: definition.version,
    modelConfig: definition.modelConfig,
    promptSchema: definition.promptSchema,
    agentFrameworkConfig: definition.agentFrameworkConfig,
    agentTools: definition.agentTools,
    avatarUrl: definition.avatarUrl,
    agentFrameworkID: definition.agentFrameworkID,
    heartbeat: definition.heartbeat,
  };
}

function applyAgentDefinitionPatch(entity: AgentDefinitionEntity, patch: Partial<AgentDefinition>): void {
  if (patch.name !== undefined) entity.name = patch.name;
  if (patch.description !== undefined) entity.description = patch.description;
  if (patch.systemPrompt !== undefined) entity.systemPrompt = patch.systemPrompt;
  if (patch.tools !== undefined) entity.tools = [...patch.tools];
  if (patch.version !== undefined) entity.version = patch.version;
  if (patch.modelConfig !== undefined) entity.modelConfig = patch.modelConfig;
  if (patch.promptSchema !== undefined) entity.promptSchema = patch.promptSchema;
  if (patch.agentFrameworkConfig !== undefined) entity.agentFrameworkConfig = patch.agentFrameworkConfig;
  if (patch.agentTools !== undefined) entity.agentTools = patch.agentTools;
  if (patch.avatarUrl !== undefined) entity.avatarUrl = patch.avatarUrl;
  if (patch.agentFrameworkID !== undefined) entity.agentFrameworkID = patch.agentFrameworkID;
  if (patch.heartbeat !== undefined) entity.heartbeat = patch.heartbeat;
}

@injectable()
export class AgentDefinitionService implements IAgentDefinitionService {
  @inject(serviceIdentifier.Database)
  private readonly databaseService!: IDatabaseService;
  @inject(serviceIdentifier.AgentBrowser)
  private readonly agentBrowserService!: IAgentBrowserService;

  private dataSource: DataSource | null = null;
  private agentDefRepository: Repository<AgentDefinitionEntity> | null = null;

  public async initialize(): Promise<void> {
    try {
      // Initialize the database
      await this.databaseService.initializeDatabase('agent');
      logger.debug('Agent database initialized');
      this.dataSource = await this.databaseService.getDatabase('agent');
      this.agentDefRepository = this.dataSource.getRepository(AgentDefinitionEntity);
      logger.debug('Agent repositories initialized');

      // Check if database is empty and initialize with default agents if needed
      await this.initializeDefaultAgentsIfEmpty();
      logger.debug('Agent handlers registered');

      // Initialize dependent services (using container.get to avoid circular dependency)
      const agentInstanceService = container.get<IAgentInstanceService>(serviceIdentifier.AgentInstance);
      if (agentInstanceService) {
        await agentInstanceService.initialize();
      } else {
        logger.warn('agentInstanceService not ready yet during AgentDefinitionService initialization');
      }

      if (this.agentBrowserService) {
        await this.agentBrowserService.initialize();
      } else {
        logger.warn('agentBrowserService not ready yet during AgentDefinitionService initialization');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to initialize agent service: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Initialize default agents if database is empty (for first-time users)
   */
  private async initializeDefaultAgentsIfEmpty(): Promise<void> {
    if (!this.agentDefRepository) {
      throw new Error('Agent repositories not initialized');
    }

    try {
      // Check if database is empty
      const existingCount = await this.agentDefRepository.count();
      if (existingCount === 0) {
        logger.info('Agent database is empty, initializing with default agents');
        const defaultAgentsList = getOfficialAgentDefinitions();
        // Core owns the built-in profiles. This database is only the App UI's
        // editable/listing projection; the UtilityProcess executes Core's
        // canonical profile for the same id.
        const agentDefinitionEntities = defaultAgentsList.map(defaultAgent => this.agentDefRepository!.create(agentDefinitionToEntity(defaultAgent)));
        // Save all default agents to database
        await this.agentDefRepository.save(agentDefinitionEntities);
        logger.info(`Initialized ${defaultAgentsList.length} default agents in database`);
      } else {
        logger.debug(`Agent database already contains ${existingCount} agents, skipping default initialization`);
      }
    } catch (error) {
      logger.error(`Failed to initialize default agents: ${error as Error}`);
      throw error;
    }
  }

  /**
   * Ensure repositories are initialized
   */
  private ensureRepositories(): void {
    if (!this.agentDefRepository) {
      throw new Error('Agent repositories not initialized');
    }
  }

  // Create a new agent definition
  public async createAgentDef(agent: AgentDefinition): Promise<AgentDefinition> {
    this.ensureRepositories();

    try {
      // Generate ID if not provided
      if (!agent.id) {
        agent.id = nanoid();
      }

      const agentDefinitionEntity = this.agentDefRepository!.create(agentDefinitionToEntity(agent));

      await this.agentDefRepository!.save(agentDefinitionEntity);
      logger.info(`Created agent definition: ${agent.id}`);

      return entityToAgentDefinition(agentDefinitionEntity);
    } catch (error) {
      logger.error(`Failed to create agent definition: ${error as Error}`);
      throw error;
    }
  }

  // Update existing agent definition
  public async updateAgentDef(agent: Partial<AgentDefinition> & { id: string }): Promise<AgentDefinition> {
    this.ensureRepositories();

    try {
      // Check if agent exists
      const existingAgent = await this.agentDefRepository!.findOne({
        where: { id: agent.id },
      });

      if (!existingAgent) {
        throw new Error(`Agent definition not found: ${agent.id}`);
      }

      applyAgentDefinitionPatch(existingAgent, agent);

      await this.agentDefRepository!.save(existingAgent);
      logger.info(`Updated agent definition: ${agent.id}`);

      return entityToAgentDefinition(existingAgent);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to update agent definition: ${errorMessage}`);
      throw error;
    }
  }

  // Get all available agent definitions
  public async getAgentDefs(): Promise<AgentDefinition[]> {
    this.ensureRepositories();

    try {
      // Get agent definitions from database (no server-side search; client should filter)
      const agentDefsFromDB = await this.agentDefRepository!.find();

      return agentDefsFromDB.map(entityToAgentDefinition);
    } catch (error) {
      logger.error(`Failed to get agent definitions: ${error as Error}`);
      throw error;
    }
  }

  // Get specific agent definition by ID or default agent if ID not provided
  public async getAgentDef(definitionId?: string): Promise<AgentDefinition | undefined> {
    this.ensureRepositories();

    try {
      // Get Core's explicit default profile when no ID was provided. Database
      // order must not silently change the default execution contract.
      if (!definitionId) {
        definitionId = DEFAULT_AGENT_DEFINITION_ID;
      }

      // Find agent in database
      const entity = await this.agentDefRepository!.findOne({
        where: { id: definitionId },
      });

      if (!entity) {
        return undefined;
      }

      return entityToAgentDefinition(entity);
    } catch (error) {
      logger.error(`Failed to get agent definition: ${error as Error}`);
      throw error;
    }
  }

  // Delete agent definition and all associated instances
  // Note: This will delegate instance deletion to AgentInstanceService
  public async deleteAgentDef(id: string): Promise<void> {
    this.ensureRepositories();

    try {
      // Delete the agent definition - instances will be handled by cleanup processes
      await this.agentDefRepository!.delete(id);
      logger.info(`Deleted agent definition: ${id}`);
    } catch (error) {
      logger.error(`Failed to delete agent definition: ${error as Error}`);
      throw error;
    }
  }

  public async getAgentTemplates(): Promise<AgentDefinition[]> {
    try {
      const templates: AgentDefinition[] = [];

      // Project the current Core profiles instead of returning a bundled copy.
      const defaultAgentsList = getOfficialAgentDefinitions();
      templates.push(...defaultAgentsList);

      logger.debug(`Found ${templates.length} agent templates`, {
        total: templates.length,
        defaultAgents: defaultAgentsList.length,
      });

      return templates;
    } catch (error) {
      logger.error(`Failed to get agent templates: ${error as Error}`);
      throw error;
    }
  }
}
