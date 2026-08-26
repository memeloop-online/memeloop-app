/**
 * Prompt Modifiers
 *
 * Modifiers transform the prompt tree without involving LLM tool calling.
 * They work in the processPrompts and postProcess phases only.
 */

// Re-export defineModifier API
export { defineModifier } from './defineModifier';
export type { InsertContentOptions, ModifierDefinition, ModifierHandlerContext, PostProcessModifierContext } from './defineModifier';

// Export modifiers
export { fullReplacementModifierDefinition, FullReplacementParameterSchema, getFullReplacementParameterSchema } from './fullReplacement';
export type { FullReplacementParameter } from './fullReplacement';

export { dynamicPositionModifierDefinition, DynamicPositionParameterSchema, getDynamicPositionParameterSchema } from './dynamicPosition';
export type { DynamicPositionParameter } from './dynamicPosition';
