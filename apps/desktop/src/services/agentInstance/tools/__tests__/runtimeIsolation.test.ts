import type { AgentFrameworkContext } from '@services/agentInstance/agentFrameworks/utilities/type';
import { promptConcatStream } from '@services/agentInstance/promptConcat/promptConcat';
import type { ToolDefinition } from 'memeloop/tools';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';

import { AppAgentToolRuntime } from '../runtime';

const IsolationConfigSchema = z.object({ targetId: z.string() });
const isolationDefinition = {
  toolId: 'runtime-isolation-marker',
  displayName: 'Runtime isolation marker',
  description: 'Test-only prompt marker',
  configSchema: IsolationConfigSchema,
  onProcessPrompts({ config, injectContent }) {
    injectContent({
      targetId: config.targetId,
      position: 'after',
      content: 'only-runtime-a',
      id: 'runtime-a-marker',
    });
  },
} satisfies ToolDefinition<typeof IsolationConfigSchema>;

function previewContext(): AgentFrameworkContext {
  return {
    agent: {
      id: 'preview-agent',
      messages: [],
      agentDefId: 'preview-definition',
      status: { state: 'working', modified: new Date() },
      created: new Date(),
    },
    agentDef: {
      id: 'preview-definition',
      name: 'Preview definition',
      agentFrameworkConfig: {},
    },
    isCancelled: () => false,
  };
}

async function preview(runtime: AppAgentToolRuntime): Promise<unknown[]> {
  const stream = promptConcatStream(
    {
      agentFrameworkConfig: {
        prompts: [{ id: 'system', caption: 'System', text: 'base' }],
        response: [],
        plugins: [{
          id: 'marker-config',
          toolId: isolationDefinition.toolId,
          'runtime-isolation-markerParam': { targetId: 'system' },
        }],
      },
    },
    [],
    previewContext(),
    runtime,
  );
  let result: unknown[] = [];
  for await (const state of stream) result = state.processedPrompts;
  return result;
}

describe('AppAgentToolRuntime isolation', () => {
  it('keeps definitions, schemas, preview plugins and disposal runtime-local', async () => {
    const runtimeA = new AppAgentToolRuntime([isolationDefinition]);
    const runtimeB = new AppAgentToolRuntime([]);

    expect(runtimeA.getAllToolDefinitions().has(isolationDefinition.toolId)).toBe(true);
    expect(runtimeB.getAllToolDefinitions().has(isolationDefinition.toolId)).toBe(false);
    expect(runtimeA.getToolParameterSchema(isolationDefinition.toolId)).toBe(IsolationConfigSchema);
    expect(runtimeB.getToolParameterSchema(isolationDefinition.toolId)).toBeUndefined();
    runtimeA.workerBridgeTools.register('runtime-a-bridge', () => 'a');
    expect(runtimeB.workerBridgeTools.listTools()).not.toContain('runtime-a-bridge');

    expect(JSON.stringify(await preview(runtimeA))).toContain('only-runtime-a');
    expect(JSON.stringify(await preview(runtimeB))).not.toContain('only-runtime-a');

    const runtimeBFullReplacement = runtimeB.promptPlugins.get('fullReplacement');
    runtimeA.dispose();
    runtimeA.dispose();
    expect(runtimeA.promptPlugins.size).toBe(0);
    expect(runtimeA.getAllToolDefinitions().size).toBe(0);
    expect(runtimeA.workerBridgeTools.listTools()).toEqual([]);
    expect(runtimeB.promptPlugins.get('fullReplacement')).toBe(runtimeBFullReplacement);
    expect(runtimeB.getAllRegisteredToolIds()).toContain('fullReplacement');

    runtimeB.dispose();
  });
});
