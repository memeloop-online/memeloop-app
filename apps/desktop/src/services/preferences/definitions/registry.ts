import { z } from 'zod';
import { aiAgentSection } from './aiAgent';
import { aiModelsSection } from './aiModels';
import { downloadsSection } from './downloads';
import { externalAPISection } from './externalAPI';
import { generalSection } from './general';
import { languagesSection } from './languages';
import { notificationsSection } from './notifications';
import { performanceSection } from './performance';
import { systemSection } from './system';
import type { IBooleanPreferenceItem, IEnumPreferenceItem, ISectionDefinition, IStringPreferenceItem, PreferenceItemDefinition } from './types';
import { updatesSection } from './updates';

/**
 * Ordered list of all sections. Display order matches array order.
 */
export const allSections: ISectionDefinition[] = [
  generalSection,
  externalAPISection,
  aiModelsSection,
  aiAgentSection,
  notificationsSection,
  systemSection,
  languagesSection,
  downloadsSection,
  performanceSection,
  updatesSection,
];

/** Map from section ID to its definition */
export const sectionById = new Map<string, ISectionDefinition>(
  allSections.map((s) => [s.id, s]),
);

/**
 * Type guard: is this a preference-backed item (has a `key`)?
 */
export type PreferenceItem =
  | IBooleanPreferenceItem
  | IEnumPreferenceItem
  | IStringPreferenceItem;

export function isPreferenceItem(
  item: PreferenceItemDefinition,
): item is PreferenceItem {
  return item.type.startsWith('preference-');
}

/**
 * Collect all preference keys declared across all sections.
 * Used to build the Zod schema and for search.
 */
export function getAllPreferenceItems(): PreferenceItem[] {
  const items: PreferenceItem[] = [];
  for (const section of allSections) {
    for (const item of section.items) {
      if (isPreferenceItem(item)) {
        items.push(item);
      }
    }
  }
  return items;
}

/**
 * Build the unified Zod schema from all section definitions.
 * Fields not covered by definitions (such as internal notification/analytics state)
 * are added here as extra fields.
 */
export function buildZodSchema(): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};
  for (const item of getAllPreferenceItems()) {
    shape[item.key] = item.zod;
  }
  // Extra fields not managed by section definitions but part of IPreferences
  shape.pauseNotifications = z.string().optional();
  // Schedule fields rendered by custom TimePicker component
  shape.pauseNotificationsBySchedule = z.boolean();
  shape.pauseNotificationsByScheduleFrom = z.string();
  shape.pauseNotificationsByScheduleTo = z.string();
  // Language is managed by a custom selector
  shape.language = z.string();
  // Service settings not currently rendered by a built-in preference item.
  shape.analyticsEnabled = z.boolean();
  shape.analyticsHost = z.string();
  shape.analyticsHostname = z.string();
  shape.analyticsSiteId = z.string();
  shape.externalAPIDebug = z.boolean();
  return z.object(shape);
}

/** The derived Zod schema — replaces the old zodSchema.ts */
export const zodPreferencesSchema = buildZodSchema();
