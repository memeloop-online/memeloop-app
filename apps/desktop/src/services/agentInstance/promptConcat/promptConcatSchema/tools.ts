// Import parameter types from plugin files
// Modifiers
import type { DynamicPositionParameter, FullReplacementParameter } from '../modifiers';
// LLM Tools
import type { ModelContextProtocolParameter } from '@services/agentInstance/tools/modelContextProtocol';
import type { ToolApprovalConfig } from '@services/agentInstance/tools/types';

/**
 * Type definition for prompt concat plugin (both modifiers and LLM tools)
 * This includes all possible parameter fields for type safety
 */
export type IPromptConcatTool = {
  [key: string]: unknown;
  id: string;
  caption?: string;
  content?: string;
  enabled?: boolean;
  forbidOverrides?: boolean;
  toolId: string;

  /** Per-tool approval configuration */
  approval?: ToolApprovalConfig;
  /** Per-tool execution timeout in ms (overrides global default) */
  timeoutMs?: number;

  // Modifier parameters
  fullReplacementParam?: FullReplacementParameter;
  dynamicPositionParam?: DynamicPositionParameter;

  // LLM Tool parameters
  modelContextProtocolParam?: ModelContextProtocolParameter;
};
