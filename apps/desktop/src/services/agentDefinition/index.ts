import { inject, injectable } from 'inversify';
import type { AgentDefinition } from 'memeloop';
import { digestNormalizedScript, normalizeScript } from 'memeloop';
import { nanoid } from 'nanoid';
import { DataSource, Repository } from 'typeorm';

import type { IAgentBrowserService } from '@services/agentBrowser/interface';
import type { IAgentInstanceService } from '@services/agentInstance/interface';
import { container } from '@services/container';
import type { IDatabaseService } from '@services/database/interface';
import { AgentDefinitionEntity } from '@services/database/schema/agent';
import { logger } from '@services/libs/log';
import serviceIdentifier from '@services/serviceIdentifier';
import type { AgentInitializationStatus } from '@services/startupLifecycle';
import { DEFAULT_AGENT_DEFINITION_ID, getOfficialAgentDefinitions } from './builtinAgentDefinitions';
import type { AgentDefinitionRuntimeSnapshot, IAgentDefinitionService } from './interface';

/** Map the physical TypeORM row to Core's portable definition exactly once. */
function isDefined<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

function entityToAgentDefinition(entity: AgentDefinitionEntity): AgentDefinition {
  const loopId = entity.loopId ??
    (entity.agentFrameworkID === 'agent-tool-loop' || entity.agentFrameworkID === 'agent-agent-loop' ? entity.agentFrameworkID : undefined);
  return {
    id: entity.id,
    name: entity.name,
    description: entity.description,
    systemPrompt: entity.systemPrompt,
    tools: [...entity.tools],
    version: entity.version,
    ...(isDefined(loopId) ? { loopId } : {}),
    ...(isDefined(entity.scriptReference) ? { scriptReference: entity.scriptReference } : {}),
    ...(isDefined(entity.metadata) ? { metadata: entity.metadata } : {}),
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
    loopId: definition.loopId,
    scriptReference: definition.scriptReference,
    metadata: definition.metadata,
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
  if (patch.loopId !== undefined) entity.loopId = patch.loopId;
  if (patch.scriptReference !== undefined) entity.scriptReference = patch.scriptReference;
  if (patch.metadata !== undefined) entity.metadata = patch.metadata;
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
  private publishRuntime: ((snapshot: AgentDefinitionRuntimeSnapshot) => Promise<void>) | undefined;
  private initializationStatus: AgentInitializationStatus = {
    state: 'starting',
    recoveryRequired: false,
  };

  public getInitializationStatus(): AgentInitializationStatus {
    return { ...this.initializationStatus };
  }

  public async configureRuntimePublisher(publish: (snapshot: AgentDefinitionRuntimeSnapshot) => Promise<void>): Promise<void> {
    this.publishRuntime = publish;
    await this.publishRuntimeDefinitions();
  }

  private async publishRuntimeDefinitions(): Promise<void> {
    if (!this.publishRuntime) return;
    this.ensureRepositories();
    const entities = await this.agentDefRepository!.find();
    await this.publishRuntime({
      definitions: entities.map(entityToAgentDefinition),
      approvedScriptDigests: entities.flatMap(entity => entity.approvedScriptDigest ? [entity.approvedScriptDigest] : []),
    });
  }

  public async initialize(): Promise<void> {
    this.initializationStatus = { state: 'starting', recoveryRequired: false };
    try {
      // Initialize the database
      await this.databaseService.initializeDatabase('agent');
      this.dataSource = await this.databaseService.getDatabase('agent');
      this.agentDefRepository = this.dataSource.getRepository(AgentDefinitionEntity);
      // Only report success after TypeORM has connected and completed schema
      // setup. `initializeDatabase` intentionally skips existing files, so a
      // stale cache can still fail during getDatabase().
      logger.debug('Agent database initialized');
      logger.debug('Agent repositories initialized');

      // Seed new installations and complete the canonical fields on legacy rows.
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
      this.initializationStatus = { state: 'ready', recoveryRequired: false };
    } catch (error) {
      this.initializationStatus = { state: 'unavailable', recoveryRequired: true };
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to initialize agent service: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Seed the catalogue and backfill fields introduced after its first release.
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
        // Core provides the defaults; saved definitions are also published to
        // the UtilityProcess so the editor and execution use the same profile.
        const agentDefinitionEntities = defaultAgentsList.map(defaultAgent => this.agentDefRepository!.create(agentDefinitionToEntity(defaultAgent)));
        // Save all default agents to database
        await this.agentDefRepository.save(agentDefinitionEntities);
        logger.info(`Initialized ${defaultAgentsList.length} default agents in database`);
      } else {
        for (const builtin of getOfficialAgentDefinitions()) {
          const existing = await this.agentDefRepository.findOneBy({ id: builtin.id });
          if (!existing) continue;
          const patch: Partial<AgentDefinitionEntity> = {};
          if (existing.loopId == null && builtin.loopId !== undefined) {
            patch.loopId = existing.agentFrameworkID === 'agent-tool-loop' || existing.agentFrameworkID === 'agent-agent-loop'
              ? existing.agentFrameworkID
              : builtin.loopId;
          }
          if ((existing.loopId ?? patch.loopId) === builtin.loopId) {
            if (existing.scriptReference == null && builtin.scriptReference !== undefined) patch.scriptReference = builtin.scriptReference;
            if (existing.metadata == null && builtin.metadata !== undefined) patch.metadata = builtin.metadata;
          }
          if (Object.keys(patch).length > 0) {
            await this.agentDefRepository.save(Object.assign(existing, patch));
          }
        }
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
      await this.publishRuntimeDefinitions();
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

      if (agent.scriptReference !== undefined && existingAgent.approvedScriptDigest) {
        const digest = agent.scriptReference.kind === 'source'
          ? await digestNormalizedScript(normalizeScript(agent.scriptReference.source))
          : null;
        if (digest !== existingAgent.approvedScriptDigest) existingAgent.approvedScriptDigest = null;
      }
      applyAgentDefinitionPatch(existingAgent, agent);

      await this.agentDefRepository!.save(existingAgent);
      await this.publishRuntimeDefinitions();
      logger.info(`Updated agent definition: ${agent.id}`);

      return entityToAgentDefinition(existingAgent);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to update agent definition: ${errorMessage}`);
      throw error;
    }
  }

  public async saveAgentLoopScript(input: { id: string; loopId: string; source: string; metadata?: Record<string, unknown> }): Promise<AgentDefinition> {
    this.ensureRepositories();
    const entity = await this.agentDefRepository!.findOneByOrFail({ id: input.id });
    if (input.loopId !== 'agent-tool-loop' && input.loopId !== 'agent-agent-loop') throw new Error(`Unknown agent loop: ${input.loopId}`);
    entity.loopId = input.loopId;
    entity.agentFrameworkID = input.loopId;
    entity.scriptReference = { kind: 'source', source: input.source, name: `${input.id}.mjs` };
    if (input.metadata !== undefined) entity.metadata = input.metadata;
    entity.approvedScriptDigest = await digestNormalizedScript(normalizeScript(input.source));
    await this.agentDefRepository!.save(entity);
    await this.publishRuntimeDefinitions();
    return entityToAgentDefinition(entity);
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
      await this.publishRuntimeDefinitions();
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
