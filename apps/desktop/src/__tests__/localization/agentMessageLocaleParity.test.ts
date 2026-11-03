import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const localizationRoot = path.resolve(import.meta.dirname, '../../../localization');
const supportedLanguages = JSON.parse(
  fs.readFileSync(path.join(localizationRoot, 'supportedLanguages.json'), 'utf8'),
) as Record<string, string>;

type MessageLabels = Record<string, unknown> & { AskQuestion?: Record<string, unknown> };

function messageLabels(locale: string): MessageLabels {
  const agent = JSON.parse(
    fs.readFileSync(path.join(localizationRoot, 'locales', locale, 'agent.json'), 'utf8'),
  ) as { Chat?: { Message?: MessageLabels } };
  return agent.Chat?.Message ?? {};
}

describe('agent message locale parity', () => {
  it('ships every reusable message label in every supported locale', () => {
    const requiredKeys = [
      'AttachmentAlt',
      'AttachmentLoadFailed',
      'NoDetails',
      'LoadDetails',
      'ReloadDetails',
      'HideDetails',
      'ShowDetails',
      'DetailTruncated',
      'DetailLoadFailed',
      'ExportFullMessage',
      'Reasoning',
      'Thinking',
      'ShowReasoning',
      'HideReasoning',
      'LoadMoreReasoning',
      'ReasoningLoadFailed',
      'Error',
      'ToolResult',
      'ToolCall',
      'Truncated',
      'TruncatedDetail',
      'TruncatedExport',
    ];
    const requiredQuestionKeys = ['AnswerPlaceholder', 'Submit', 'ConfirmSelection', 'Answered'];

    for (const locale of Object.keys(supportedLanguages)) {
      const labels = messageLabels(locale);
      expect(Object.keys(labels), locale).toEqual(expect.arrayContaining(requiredKeys));
      for (const key of requiredKeys) expect(labels[key], `${locale}:${key}`).toMatch(/\S/);
      expect(labels.ToolCall, locale).toContain('{{toolName}}');
      for (const key of ['Truncated', 'TruncatedDetail', 'TruncatedExport']) {
        expect(labels[key], `${locale}:${key}`).toContain('{{count}}');
      }

      const askQuestion = labels.AskQuestion ?? {};
      expect(Object.keys(askQuestion), `${locale}:AskQuestion`).toEqual(expect.arrayContaining(requiredQuestionKeys));
      for (const key of requiredQuestionKeys) expect(askQuestion[key], `${locale}:AskQuestion.${key}`).toMatch(/\S/);
    }
  });
});
