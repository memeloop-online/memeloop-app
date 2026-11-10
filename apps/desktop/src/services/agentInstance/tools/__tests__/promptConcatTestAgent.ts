import type { AgentDefinition } from '@services/agentDefinition/interface';

/** Test-only fixture for the legacy prompt-concat modifier unit tests. */
export const promptConcatTestAgent = {
  id: 'test:prompt-concat',
  name: 'Prompt concat test agent',
  description: 'Test agent for prompt concatenation',
  systemPrompt: 'Test system prompt',
  tools: [],
  version: '1.0.0',
  agentFrameworkID: 'memeloopTaskAgentWorker',
  agentFrameworkConfig: {
    prompts: [
      {
        id: 'system',
        role: 'system',
        children: [{ id: 'default-system', text: 'Test system prompt' }],
      },
      {
        id: 'history',
        role: 'user',
        children: [{ id: 'default-history', text: 'No history' }],
      },
    ],
    response: [{ id: 'default-response', caption: 'LLM response' }],
    plugins: [
      {
        id: 'test-history-replacement',
        toolId: 'fullReplacement',
        fullReplacementParam: {
          targetId: 'default-history',
          sourceType: 'historyOfSession',
          contextWindowSize: 120_000,
        },
      },
      {
        id: 'test-response-replacement',
        toolId: 'fullReplacement',
        fullReplacementParam: {
          targetId: 'default-response',
          sourceType: 'llmResponse',
        },
      },
    ],
  },
} satisfies AgentDefinition;
