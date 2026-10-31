import { AgentChannel } from '@/constants/channels';
import type { AgentInitializationStatus } from '@services/startupLifecycle';
import { ProxyPropertyType } from 'electron-ipc-cat/common';
import type { AgentDefinition, AgentDefinitionToolConfig, AgentHeartbeatConfig, AgentModelConfig, ToolCallingMatch } from 'memeloop';

/**
 * Agent service to manage agent definitions
 */
export interface IAgentDefinitionService {
  /**
   * Initialize the service on application startup.
   */
  initialize(): Promise<void>;
  /** Read-only startup health used by the renderer to fail closed. */
  getInitializationStatus(): AgentInitializationStatus;
  /**
   * Create a new agent definition and persist it to the database.
   * Generates a new id when `agent.id` is not provided.
   * @param agent Agent definition to create
   * @returns The created AgentDefinition (including generated id)
   */
  createAgentDef(agent: AgentDefinition): Promise<AgentDefinition>;
  /**
   * Update an existing agent definition. Only the provided fields will be updated.
   * @param agent Partial agent definition containing the required `id` field
   * @returns The updated AgentDefinition
   */
  updateAgentDef(agent: Partial<AgentDefinition> & { id: string }): Promise<AgentDefinition>;
  /**
   * Get all available agent definitions.
   * This returns simplified definitions (without handler instances). No server-side
   * search is performed; clients should apply any filtering required.
   */
  getAgentDefs(): Promise<AgentDefinition[]>;
  /**
   * Get a specific agent definition by id. When `id` is omitted, returns the default
   * Core agent definition.
   * @param id Optional agent id
   */
  getAgentDef(id?: string): Promise<AgentDefinition | undefined>;
  /**
   * Get all available agent templates from Core's built-in profiles.
   * This returns fully populated templates suitable for creating new agents. No server-side
   * search filtering is performed; clients should filter templates as needed.
   */
  getAgentTemplates(): Promise<AgentDefinition[]>;
  /**
   * Delete an agent definition
   * @param id Agent definition ID
   */
  deleteAgentDef(id: string): Promise<void>;
}

export type { AgentDefinition, AgentDefinitionToolConfig, AgentHeartbeatConfig, AgentModelConfig, ToolCallingMatch };

export const AgentDefinitionServiceIPCDescriptor = {
  channel: AgentChannel.definition,
  properties: {
    getInitializationStatus: ProxyPropertyType.Function,
    createAgentDef: ProxyPropertyType.Function,
    updateAgentDef: ProxyPropertyType.Function,
    getAgentDefs: ProxyPropertyType.Function,
    getAgentDef: ProxyPropertyType.Function,
    getAgentTemplates: ProxyPropertyType.Function,
    deleteAgentDef: ProxyPropertyType.Function,
  },
};
