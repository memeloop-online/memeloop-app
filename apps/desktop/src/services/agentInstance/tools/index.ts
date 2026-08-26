import { logger } from '@services/libs/log';
import { AsyncSeriesHook, AsyncSeriesWaterfallHook } from 'tapable';

import { registerCoreInfrastructure } from '../promptConcat/infrastructure';
import type { AppAgentToolRuntime } from './runtime';
import type { PromptConcatHooks } from './types';

export { AppAgentToolRuntime, bootstrapAppAgentToolRuntime } from './runtime';
export type { AgentResponse, PostProcessContext, PromptConcatHookContext, PromptConcatHooks, PromptConcatTool, ResponseHookContext } from './types';

export function createAgentFrameworkHooks(): PromptConcatHooks {
  return {
    processPrompts: new AsyncSeriesWaterfallHook(['context']),
    finalizePrompts: new AsyncSeriesWaterfallHook(['context']),
    postProcess: new AsyncSeriesWaterfallHook(['context']),
    userMessageReceived: new AsyncSeriesHook(['context']),
    agentStatusChanged: new AsyncSeriesHook(['context']),
    toolExecuted: new AsyncSeriesHook(['context']),
    responseUpdate: new AsyncSeriesHook(['context']),
    responseComplete: new AsyncSeriesHook(['context']),
  };
}

export async function registerPluginsToHooks(
  hooks: PromptConcatHooks,
  agentFrameworkConfig: { plugins?: Array<{ toolId: string; [key: string]: unknown }> },
  runtime: AppAgentToolRuntime,
): Promise<void> {
  registerCoreInfrastructure(hooks);
  for (const pluginConfig of agentFrameworkConfig.plugins ?? []) {
    if (pluginConfig.enabled === false) continue;
    const plugin = runtime.promptPlugins.get(pluginConfig.toolId);
    if (!plugin) {
      if (pluginConfig.optional === true) continue;
      throw new Error(`Configured prompt plugin is not registered: ${pluginConfig.toolId}`);
    }
    // Both hook ABIs intentionally expose tapAsync/promise slots. The App
    // preview is transitional; production execution owns the same definition
    // through Core's runtime-scoped registry in the UtilityProcess.
    plugin(hooks as never);
    logger.debug('Registered runtime-scoped prompt plugin', { toolId: pluginConfig.toolId });
  }
}

export async function createHooksWithPlugins(
  agentFrameworkConfig: { plugins?: Array<{ toolId: string; [key: string]: unknown }> },
  runtime: AppAgentToolRuntime,
): Promise<{ hooks: PromptConcatHooks; pluginConfigs: Array<{ toolId: string; [key: string]: unknown }> }> {
  const hooks = createAgentFrameworkHooks();
  await registerPluginsToHooks(hooks, agentFrameworkConfig, runtime);
  return { hooks, pluginConfigs: agentFrameworkConfig.plugins ?? [] };
}
