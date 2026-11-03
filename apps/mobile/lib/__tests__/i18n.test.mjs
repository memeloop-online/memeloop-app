import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { MOBILE_LABELS, getMobileLabels, resolveMobileLocale } from '../i18n.ts';

function leafKeys(value, prefix = '') {
  if (typeof value === 'function') return [prefix];
  if (!value || typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key));
}

test('mobile dictionaries have identical label shape and locale resolution', () => {
  const [firstLocale, ...otherLocales] = Object.keys(MOBILE_LABELS);
  const expected = leafKeys(MOBILE_LABELS[firstLocale]).filter(key => key !== 'locale');
  for (const locale of otherLocales) {
    assert.deepEqual(leafKeys(MOBILE_LABELS[locale]).filter(key => key !== 'locale'), expected, locale);
  }
  assert.equal(resolveMobileLocale('zh-CN'), 'zh-Hans');
  assert.equal(resolveMobileLocale('ja-JP'), 'ja');
  assert.equal(resolveMobileLocale('en-GB'), 'en');
  assert.equal(getMobileLabels('zh-CN').home.title, 'MemeLoop 移动端');
});

test('screen labels remain bounded for narrow mobile layouts', () => {
  const allLabels = Object.values(MOBILE_LABELS).flatMap(labels => leafKeys(labels).map(key => key));
  assert.ok(allLabels.length > 0);
  for (const labels of Object.values(MOBILE_LABELS)) {
    for (const key of leafKeys(labels)) {
      const segments = key.split('.');
      let current = labels;
      for (const segment of segments) current = current[segment];
      if (typeof current === 'string') {
        assert.ok(current.length > 0, `${labels.locale}:${key} must not be empty`);
        assert.ok(current.length <= 512, `${labels.locale}:${key} exceeds the narrow-screen label bound`);
        assert.equal(current.includes('\n'), false, `${labels.locale}:${key} must not contain layout-breaking newlines`);
      }
    }
  }
});

test('work disclosures and tool details are localized in every shipped language', () => {
  const expected = {
    en: ['Completed work · 3 steps', '2 tool calls'],
    'zh-Hans': ['已完成 · 3 步', '2 次工具调用'],
    ja: ['完了 · 3 ステップ', '2 回のツール呼び出し'],
  };
  for (const [locale, [completed, tools]] of Object.entries(expected)) {
    const { chat } = getMobileLabels(locale);
    assert.equal(chat.completedWork(3), completed);
    assert.equal(chat.toolGroup(2), tools);
    for (const key of ['waiting', 'toolInput', 'toolResult', 'toolInputTruncated', 'loadMoreDetails']) {
      assert.ok(chat[key].length > 0, `${locale}:${key}`);
      if (locale !== 'en') assert.notEqual(chat[key], MOBILE_LABELS.en.chat[key], `${locale}:${key}`);
    }
  }
});

test('mobile screens contain no raw JSX user-facing English literals', () => {
  const root = path.resolve(import.meta.dirname, '../../app');
  for (const file of ['index.tsx', 'nodes.tsx', 'chat.tsx', 'settings.tsx']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(
      source,
      /<(?:Text|Button|Card\.Title|Dialog\.Title|List\.Subheader)\b[^>]*>\s*[A-Za-z][^<{]*<\//u,
      file,
    );
  }
});
