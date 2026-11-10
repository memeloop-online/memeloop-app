import type { AgentDefinition } from 'memeloop';
import { describe, expect, it } from 'vitest';
import { createAgentInstanceData } from '../utilities';

describe('createAgentInstanceData', () => {
  it('should create agent instance with undefined agentFrameworkConfig (fallback to definition)', () => {
    const agentDefinition: AgentDefinition = {
      id: 'test-agent-def',
      name: 'Test Agent',
      description: 'Test agent',
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
      version: '1.0.0',
      agentFrameworkConfig: {
        prompts: [
          {
            id: 'system',
            text: 'You are a helpful assistant.',
            role: 'system',
          },
        ],
        plugins: [],
      },
      agentFrameworkID: 'basicPromptConcatHandler',
    };

    const { instanceData } = createAgentInstanceData(agentDefinition);

    expect(instanceData.agentFrameworkConfig).toBeUndefined();
    expect(instanceData.agentDefId).toBe('test-agent-def');
    expect(instanceData.agentFrameworkID).toBe('basicPromptConcatHandler');
    expect(instanceData.name).toContain('Test Agent');
  });

  it('should create agent instance with undefined agentFrameworkConfig even when definition has required agentFrameworkConfig', () => {
    const agentDefinition: AgentDefinition = {
      id: 'test-agent-def-no-config',
      name: 'Test Agent No Config',
      description: 'Test agent',
      systemPrompt: 'You are a helpful assistant.',
      tools: [],
      version: '1.0.0',
      agentFrameworkID: 'basicPromptConcatHandler',
      agentFrameworkConfig: { prompts: [], plugins: [] },
    };

    const { instanceData } = createAgentInstanceData(agentDefinition);

    expect(instanceData.agentFrameworkConfig).toBeUndefined();
    expect(instanceData.agentDefId).toBe('test-agent-def-no-config');
    expect(instanceData.agentFrameworkID).toBe('basicPromptConcatHandler');
  });
});
