/** @vitest-environment node */
import { type ILLMProvider, prepareAgentExecutionModelRequest } from 'memeloop';
import { createNodeRuntime } from 'memeloop-cli';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { type DesktopModelConfiguration } from '../conversationModelParameters';
import { DesktopWorkerModelRegistry } from '../workerModelRegistry';

describe('desktop worker public model registry', () => {
  it('prepares and executes the persisted conversation route with the same parameters as preview', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'worker-model-registry-'));
    const chat = vi.fn<ILLMProvider['chat']>().mockResolvedValue('response');
    const registry = new DesktopWorkerModelRegistry({ name: 'memeloop-app-worker', chat });
    const configuration: DesktopModelConfiguration = {
      default: { providerId: 'real-account', modelId: 'global-model' },
      routes: [{
        providerId: 'real-account',
        modelId: 'logical-model',
        wireModelId: 'wire-model',
        apiMode: 'responses',
        parameters: { temperature: 0.4, maxOutputTokens: 99 },
      }, {
        providerId: 'real-account',
        modelId: 'global-model',
        wireModelId: 'global-wire',
        apiMode: 'chat-completions',
        parameters: {},
      }],
    };
    registry.update(configuration);
    const runtime = await createNodeRuntime({
      dataDir: directory,
      localNodeId: 'local',
      includeVscodeCli: false,
      workloadExecution: { enabled: false },
      providerRegistry: registry.registry,
      llmProvider: registry.registry.get('real-account')!,
      modelGateway: { routeLoops: false },
      config: {
        defaultModelConfig: configuration.default,
        agents: [{ id: 'definition', name: 'Test', description: '', systemPrompt: 'Answer the user.', tools: [], version: '1' }],
      },
    });
    const storage = runtime.storage;
    try {
      const selection = { providerId: 'real-account', modelId: 'logical-model', parameters: { reasoningEffort: 'high' as const, maxOutputTokens: 1234 } };
      await storage.appendLocalEvent({
        kind: 'metadataPatch',
        eventId: 'metadata',
        conversationId: 'conversation',
        originNodeId: 'local',
        timestamp: 1,
        patch: { definitionId: 'definition', instanceDelta: { modelConfig: selection } },
      });
      const context = runtime.context;
      const options = { conversationId: 'conversation', signal: new AbortController().signal, stream: false, inputText: 'Hello' };
      const preview = await prepareAgentExecutionModelRequest(context, options);
      const execution = await prepareAgentExecutionModelRequest(context, options);
      expect(execution.prepared.request).toEqual(preview.prepared.request);
      expect(execution.prepared.request).toMatchObject({
        providerId: 'real-account',
        logicalModelId: 'logical-model',
        wireModelId: 'wire-model',
        apiMode: 'responses',
        reasoningEffort: 'high',
        temperature: 0.4,
        maxOutputTokens: 1234,
      });
      const result = await execution.route.provider.chat(execution.prepared.request);
      expect(result).toBe('response');
      expect(chat).toHaveBeenCalledWith(preview.prepared.request);
      // A prepared request keeps its route snapshot even when settings subsequently change.
      registry.update({ routes: [] });
      expect(registry.registry.get('real-account')).toBeUndefined();
      const retried = await execution.route.provider.chat(execution.prepared.request);
      expect(retried).toBe('response');
      expect(chat).toHaveBeenCalledTimes(2);
    } finally {
      await runtime.stop();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
