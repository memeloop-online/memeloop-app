# Prompt Concat Tools

Prompt engineering and message processing with a tool-based architecture.

If final prompt is a food, then `agentFrameworkConfig.prompts` is the recipe. Chat history and user input are raw materials.

## Implementation

The `promptConcat` function uses a tapable hooks-based tool system. Built-in tools are registered by `toolId` and loaded based on configuration in `taskAgents.json`.

### Tool System Architecture

1. **Hooks**: Uses tapable `AsyncSeriesWaterfallHook` for tool execution
   - `processPrompts`: Modifies prompt tree during processing
   - `finalizePrompts`: Final processing before LLM call
   - `postProcess`: Handles response processing
   - `responseComplete`: Called when AI response is done (for tool execution)

2. **Built-in Components**:
   - **Internal Plugins** (for prompt processing):
     - `fullReplacement`: Replaces content from various sources
     - `dynamicPosition`: Inserts content at specific positions
     - `workspacesList`: Inject available workspaces into prompts
   - **LLM-Callable Tools** (AI can invoke):
     - `wikiSearch`: Search wiki content with filter or vector search
     - `wikiOperation`: Create, update, delete tiddlers, or invoke action tiddlers
     - `git`: Search git commit history and read file content from specific commits
     - `tiddlywikiPlugin`: Load TiddlyWiki plugin metadata (DataSource, Describe, Actions tags)
     - `modelContextProtocol`: Integrates with external MCP servers

3. **Tool Registration**:
   - Tool modules export pure `ToolDefinition` values and never register at import time
   - The host creates one `AppAgentToolRuntime` for each runtime lifetime
   - Preview schemas and execution hooks are resolved from that explicit runtime
   - Disposing one runtime cannot remove definitions or plugins from another

### Adding New Tools (New API)

Export a declarative definition, then let the host bootstrap it into its owned
runtime. Do not create a module singleton or mutate a shared registry:

```typescript
import { z } from 'zod/v4';
import type { ToolDefinition } from 'memeloop/tools';

// 1. Define config schema (user-configurable in UI)
const MyToolConfigSchema = z.object({
  targetId: z.string(),
  enabled: z.boolean().optional().default(true),
});

// 2. Define LLM-callable tool schema (injected into prompts)
const MyLLMToolSchema = z.object({
  query: z.string(),
  limit: z.number().optional().default(10),
}).meta({
  title: 'my-tool', // Tool name for LLM
  description: 'Search for something',
  examples: [{ query: 'example', limit: 5 }],
});

// 3. Export a pure definition
export const myToolDefinition = {
  toolId: 'myTool',
  displayName: 'My Tool',
  description: 'Does something useful',
  configSchema: MyToolConfigSchema,
  llmToolSchemas: {
    'my-tool': MyLLMToolSchema,
  },

  // Called during prompt processing
  onProcessPrompts({ config, injectToolList, injectContent }) {
    // Inject tool description into prompts
    injectToolList({
      targetId: config.targetId,
      position: 'after',
    });
  },

  // Called when AI response is complete
  async onResponseComplete({ toolCall, executeToolCall }) {
    if (!toolCall?.found || toolCall.toolId !== 'my-tool') return;

    await executeToolCall('my-tool', async (params) => {
      // Execute the tool and return result
      const result = await doSomething(params.query, params.limit);
      return { success: true, data: result };
    });
  },
} satisfies ToolDefinition<typeof MyToolConfigSchema, {
  'my-tool': typeof MyLLMToolSchema;
}>;
```

The application runtime owns the registration and disposal:

```typescript
const runtime = new AppAgentToolRuntime([myToolDefinition]);
try {
  await promptConcat(config, messages, context, runtime);
} finally {
  runtime.dispose();
}
```

### Handler Context Utilities

The `defineTool` API provides helpful utilities:

- `findPrompt(id)` - Find a prompt by ID in the tree
- `injectToolList(options)` - Inject LLM tool schemas at a position
- `injectContent(options)` - Inject arbitrary content
- `executeToolCall(toolName, executor)` - Execute and handle tool results
- `addToolResult(options)` - Manually add a tool result message
- `yieldToSelf()` - Signal the agent should continue with another round

### Legacy Tool Structure

For more complex scenarios, you can still use the raw tapable hooks:

```typescript
export const myTool: PromptConcatTool = (hooks) => {
  hooks.processPrompts.tapAsync('myTool', async (context, callback) => {
    const { toolConfig, prompts, messages } = context;
    // Tool logic here
    callback();
  });
};
```
