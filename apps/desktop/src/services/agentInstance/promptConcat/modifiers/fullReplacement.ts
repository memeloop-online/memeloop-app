import { identity } from 'lodash';
import { z } from 'zod/v4';

const t = identity;

/** Configuration schema for Core's fullReplacement prompt plugin. */
export const FullReplacementParameterSchema = z.object({
  targetId: z.string().meta({
    title: t('Schema.FullReplacement.TargetIdTitle'),
    description: t('Schema.FullReplacement.TargetId'),
  }),
  sourceType: z.enum(['historyOfSession', 'llmResponse']).meta({
    title: t('Schema.FullReplacement.SourceTypeTitle'),
    description: t('Schema.FullReplacement.SourceType'),
  }),
  contextWindowSize: z.number().optional().meta({
    title: 'Context Window Size',
    description: 'Max tokens for message history. Oldest messages are trimmed when exceeded. 0 or empty = no limit.',
  }),
}).meta({
  title: t('Schema.FullReplacement.Title'),
  description: t('Schema.FullReplacement.Description'),
});

export type FullReplacementParameter = z.infer<typeof FullReplacementParameterSchema>;

export function getFullReplacementParameterSchema() {
  return FullReplacementParameterSchema;
}
