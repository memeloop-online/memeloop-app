import { identity } from 'lodash';
import { z } from 'zod/v4';

const t = identity;

/** Configuration schema for Core's dynamicPosition prompt plugin. */
export const DynamicPositionParameterSchema = z.object({
  targetId: z.string().meta({
    title: t('Schema.Position.TargetIdTitle'),
    description: t('Schema.Position.TargetId'),
  }),
  position: z.enum(['before', 'after', 'relative']).meta({
    title: t('Schema.Position.TypeTitle'),
    description: t('Schema.Position.Type'),
  }),
}).meta({
  title: t('Schema.Position.Title'),
  description: t('Schema.Position.Description'),
});

export type DynamicPositionParameter = z.infer<typeof DynamicPositionParameterSchema>;

export function getDynamicPositionParameterSchema() {
  return DynamicPositionParameterSchema;
}
