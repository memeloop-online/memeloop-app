import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const localizationRoot = path.resolve(import.meta.dirname, '../../../localization');
const supportedLanguages = JSON.parse(
  fs.readFileSync(path.join(localizationRoot, 'supportedLanguages.json'), 'utf8'),
) as Record<string, string>;

function timeline(locale: string): Record<string, unknown> {
  const agent = JSON.parse(
    fs.readFileSync(path.join(localizationRoot, 'locales', locale, 'agent.json'), 'utf8'),
  ) as { Chat?: { Timeline?: Record<string, unknown> } };
  return agent.Chat?.Timeline ?? {};
}

function agentSwitcher(locale: string): Record<string, unknown> {
  const agent = JSON.parse(
    fs.readFileSync(path.join(localizationRoot, 'locales', locale, 'agent.json'), 'utf8'),
  ) as { AgentSwitcher?: Record<string, unknown> };
  return agent.AgentSwitcher ?? {};
}

describe('agent timeline locale parity', () => {
  it('ships every shared timeline label in every supported locale', () => {
    const requiredKeys = [
      'Navigation',
      'Turn',
      'MoreResponses',
      'Compacted',
      'LoadEarlier',
      'LoadLater',
      'Seek',
      'Close',
      'NewMessages',
    ];

    for (const locale of Object.keys(supportedLanguages)) {
      const labels = timeline(locale);
      expect(Object.keys(labels), locale).toEqual(expect.arrayContaining(requiredKeys));
      for (const key of requiredKeys) expect(labels[key], `${locale}:${key}`).toEqual(expect.any(String));
      expect(labels.MoreResponses, locale).toContain('{{count}}');
      expect(labels.NewMessages, locale).toContain('{{count}}');
    }
  });

  it('localizes the compact agent switcher used by narrow chat headers', () => {
    for (const locale of Object.keys(supportedLanguages)) {
      expect(agentSwitcher(locale).Search, locale).toEqual(expect.any(String));
    }
  });
});
