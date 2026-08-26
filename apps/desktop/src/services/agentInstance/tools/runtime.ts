import { registerBuiltinPromptPlugins } from 'memeloop/loop-api';
import { type DefinedTool, type PromptConcatTool, type ToolDefinition, ToolDefinitionRegistry, ToolSchemaRegistry } from 'memeloop/tools';

import { DynamicPositionParameterSchema } from '../promptConcat/modifiers/dynamicPosition';
import { FullReplacementParameterSchema } from '../promptConcat/modifiers/fullReplacement';
import { alarmClockToolDefinition } from './alarmClock';
import { askQuestionToolDefinition } from './askQuestion';
import { editAgentDefinitionToolDefinition } from './editAgentDefinition';
import { modelContextProtocolToolDefinition } from './modelContextProtocol';
import { spawnAgentToolDefinition } from './spawnAgent';
import { summaryToolDefinition } from './summary';
import { webFetchToolDefinition } from './webFetch';
import { WorkerToolBridgeRegistry } from './workerToolBridge';

const APP_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  modelContextProtocolToolDefinition,
  summaryToolDefinition,
  alarmClockToolDefinition,
  editAgentDefinitionToolDefinition,
  askQuestionToolDefinition,
  webFetchToolDefinition,
  spawnAgentToolDefinition,
];

const PROMPT_MODIFIER_SCHEMAS = [
  {
    toolId: 'fullReplacement',
    schema: FullReplacementParameterSchema,
    metadata: {
      displayName: 'Full Replacement',
      description: 'Replace target content with conversation history or a model response',
    },
  },
  {
    toolId: 'dynamicPosition',
    schema: DynamicPositionParameterSchema,
    metadata: {
      displayName: 'Dynamic Position',
      description: 'Move configured prompt content at runtime',
    },
  },
] as const;

/**
 * Explicitly owned App prompt/tool catalog.
 *
 * There is deliberately no module singleton: every Electron runtime/window
 * receives an independent registry and disposal cannot mutate another one.
 */
export class AppAgentToolRuntime {
  public readonly promptPlugins = new Map<string, PromptConcatTool>();
  public readonly schemas = new ToolSchemaRegistry();
  public readonly toolDefinitions = new ToolDefinitionRegistry(this.promptPlugins, this.schemas);
  public readonly workerBridgeTools = new WorkerToolBridgeRegistry();

  private readonly schemaCleanup: Array<() => boolean> = [];
  private readonly builtinPromptPlugins = new Map<string, PromptConcatTool>();
  private disposed = false;

  constructor(definitions: readonly ToolDefinition[] = APP_TOOL_DEFINITIONS) {
    registerBuiltinPromptPlugins(this.promptPlugins);
    for (const [toolId, plugin] of this.promptPlugins) this.builtinPromptPlugins.set(toolId, plugin);

    for (const modifier of PROMPT_MODIFIER_SCHEMAS) {
      this.schemaCleanup.push(this.schemas.registerOwnedToolParameterSchema(
        modifier.toolId,
        modifier.schema,
        modifier.metadata,
      ));
    }
    for (const definition of definitions) this.toolDefinitions.registerToolDefinition(definition);
  }

  getAllToolDefinitions(): ReadonlyMap<string, DefinedTool> {
    return this.toolDefinitions.getAllToolDefinitions();
  }

  getAllRegisteredToolIds(): readonly string[] {
    return [
      ...PROMPT_MODIFIER_SCHEMAS.map(entry => entry.toolId),
      ...this.toolDefinitions.getAllToolDefinitions().keys(),
    ];
  }

  getToolParameterSchema(toolId: string): unknown {
    return this.schemas.getToolParameterSchema(toolId);
  }

  getToolMetadata(toolId: string): { displayName: string; description: string } | undefined {
    return this.schemas.getToolMetadata(toolId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.workerBridgeTools.dispose();
    this.toolDefinitions.dispose();
    for (const unregister of [...this.schemaCleanup].reverse()) unregister();
    this.schemaCleanup.length = 0;
    for (const [toolId, plugin] of this.builtinPromptPlugins) {
      if (this.promptPlugins.get(toolId) === plugin) this.promptPlugins.delete(toolId);
    }
    this.builtinPromptPlugins.clear();
  }
}

export function bootstrapAppAgentToolRuntime(
  definitions?: readonly ToolDefinition[],
): AppAgentToolRuntime {
  return new AppAgentToolRuntime(definitions);
}
