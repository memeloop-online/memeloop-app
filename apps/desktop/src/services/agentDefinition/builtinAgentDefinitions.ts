import { type AgentDefinition, getBuiltinLoopProfiles, type LoopProfile } from 'memeloop';

/**
 * The App does not own a fork of MemeLoop's prompts. Keeping the UI catalogue
 * as a projection of Core profiles makes prompt/tool fixes land in every host
 * and prevents the standalone App from advertising host-only capabilities.
 */
export const DEFAULT_AGENT_DEFINITION_ID = 'memeloop:general-assistant';

export function loopProfileToAgentDefinition(profile: LoopProfile): AgentDefinition {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    systemPrompt: profile.systemPrompt ?? profile.prompts?.find(prompt => prompt.role === 'system')?.text ?? '',
    tools: profile.tools ? [...profile.tools] : [],
    version: profile.version ?? '1.0.0',
    ...(profile.modelConfig === undefined ? {} : { modelConfig: profile.modelConfig }),
    agentFrameworkID: profile.loopId ?? 'agent-tool-loop',
    ...(profile.agentFrameworkConfig === undefined ? {} : { agentFrameworkConfig: profile.agentFrameworkConfig }),
    ...(profile.avatarUrl === undefined ? {} : { avatarUrl: profile.avatarUrl }),
    agentTools: profile.agentTools?.map(tool => ({
      toolId: tool.toolId,
      ...(tool.enabled === undefined ? {} : { enabled: tool.enabled }),
      ...(tool.parameters === undefined ? {} : { parameters: tool.parameters }),
      ...(tool.tags === undefined ? {} : { tags: [...tool.tags] }),
    })),
    ...(profile.heartbeat === undefined ? {} : { heartbeat: profile.heartbeat }),
  };
}

export function getOfficialAgentDefinitions(): AgentDefinition[] {
  const definitions = getBuiltinLoopProfiles().map(loopProfileToAgentDefinition);
  if (!definitions.some(definition => definition.id === DEFAULT_AGENT_DEFINITION_ID)) {
    throw new Error(`Core default profile is unavailable: ${DEFAULT_AGENT_DEFINITION_ID}`);
  }
  return definitions;
}
