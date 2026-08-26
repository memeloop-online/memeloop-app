import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const localizationRoot = path.resolve(import.meta.dirname, '../../../localization');
const supportedLanguages = JSON.parse(
  fs.readFileSync(path.join(localizationRoot, 'supportedLanguages.json'), 'utf8'),
) as Record<string, string>;

function runErrors(locale: string): Record<string, unknown> {
  const agent = JSON.parse(
    fs.readFileSync(path.join(localizationRoot, 'locales', locale, 'agent.json'), 'utf8'),
  ) as { Chat?: { RunError?: Record<string, unknown> } };
  return agent.Chat?.RunError ?? {};
}

describe('agent run error locale parity', () => {
  it('ships long-context and message-admission guidance in every supported locale', () => {
    const requiredKeys = [
      'ContextCompactionPending',
      'ContextCompactionPendingTitle',
      'UserMessageTooLarge',
      'UserMessageTooLargeTitle',
    ];

    for (const locale of Object.keys(supportedLanguages)) {
      const labels = runErrors(locale);
      expect(Object.keys(labels), locale).toEqual(expect.arrayContaining(requiredKeys));
      for (const key of requiredKeys) expect(labels[key], `${locale}:${key}`).toEqual(expect.any(String));
      expect(labels.UserMessageTooLarge, locale).toContain('{{requested}}');
      expect(labels.UserMessageTooLarge, locale).toContain('{{limit}}');
    }
  });
});
