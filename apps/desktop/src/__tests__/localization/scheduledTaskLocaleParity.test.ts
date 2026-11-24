import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const localizationRoot = path.resolve(import.meta.dirname, '../../../localization');
const supportedLanguages = JSON.parse(
  fs.readFileSync(path.join(localizationRoot, 'supportedLanguages.json'), 'utf8'),
) as Record<string, string>;

function agentLocale(locale: string): {
  EditAgent?: Record<string, unknown>;
  Preference?: Record<string, unknown>;
} {
  return JSON.parse(
    fs.readFileSync(path.join(localizationRoot, 'locales', locale, 'agent.json'), 'utf8'),
  ) as { EditAgent?: Record<string, unknown>; Preference?: Record<string, unknown> };
}

describe('scheduled task locale parity', () => {
  it('ships every shared scheduling label in every supported locale', () => {
    const english = agentLocale('en');
    const requiredEditAgentKeys = Object.keys(english.EditAgent ?? {})
      .filter(key => key.startsWith('Schedule'));
    const requiredPreferenceKeys = [
      'NoScheduledTaskAgents',
      'ScheduledTaskAgent',
    ];

    expect(requiredEditAgentKeys.length).toBeGreaterThan(30);
    for (const locale of Object.keys(supportedLanguages)) {
      const agent = agentLocale(locale);
      const editAgent = agent.EditAgent ?? {};
      const preference = agent.Preference ?? {};
      expect(Object.keys(editAgent), locale).toEqual(expect.arrayContaining(requiredEditAgentKeys));
      expect(Object.keys(preference), locale).toEqual(expect.arrayContaining(requiredPreferenceKeys));
      for (const key of requiredEditAgentKeys) expect(editAgent[key], `${locale}:EditAgent.${key}`).toEqual(expect.any(String));
      for (const key of requiredPreferenceKeys) expect(preference[key], `${locale}:Preference.${key}`).toEqual(expect.any(String));
    }
  });
});
