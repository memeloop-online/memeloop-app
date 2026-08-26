import { getBuiltinLoopProfiles, type LoopProfile } from 'memeloop/loop-api';

import type { AgentDefinition } from './interface';

/**
 * The App does not own a fork of MemeLoop's prompts. Keeping the UI catalogue
 * as a projection of Core profiles makes prompt/tool fixes land in every host
 * and prevents the standalone App from advertising TidGi-only capabilities.
 */
export const DEFAULT_AGENT_DEFINITION_ID = 'memeloop:general-assistant';

export function loopProfileToAgentDefinition(profile: LoopProfile): AgentDefinition {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    agentFrameworkID: profile.loopId ?? 'agent-tool-loop',
    agentFrameworkConfig: profile.agentFrameworkConfig
      ? { ...profile.agentFrameworkConfig }
      : {},
    agentTools: profile.agentTools?.map(tool => ({
      toolId: tool.toolId,
      ...(tool.enabled === undefined ? {} : { enabled: tool.enabled }),
      ...(tool.parameters === undefined ? {} : { parameters: tool.parameters }),
      ...(tool.tags === undefined ? {} : { tags: [...tool.tags] }),
    })),
  };
}

export function getOfficialAgentDefinitions(): AgentDefinition[] {
  const definitions = getBuiltinLoopProfiles().map(loopProfileToAgentDefinition);
  if (!definitions.some(definition => definition.id === DEFAULT_AGENT_DEFINITION_ID)) {
    throw new Error(`Core default profile is unavailable: ${DEFAULT_AGENT_DEFINITION_ID}`);
  }
  return definitions;
}
