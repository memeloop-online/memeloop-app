// Import parameter types from plugin files
// Modifiers
import type { DynamicPositionParameter } from '../modifiers/dynamicPosition';
import type { FullReplacementParameter } from '../modifiers/fullReplacement';
// LLM Tools
import type { ModelContextProtocolParameter } from '@services/agentInstance/tools/modelContextProtocol';

export type ToolApprovalMode = 'auto' | 'confirm';

export interface ToolApprovalConfig {
  mode: ToolApprovalMode;
  allowPatterns?: string[];
  denyPatterns?: string[];
  timeoutMs?: number;
}

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
