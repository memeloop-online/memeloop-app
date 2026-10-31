/**
 * Precisely detects same-level duplicate keys in JSON locale files.
 * A JSON object like { "a": 1, "a": 2 } is technically invalid but parseable.
 * JSON.parse silently picks the last value, so we must scan the raw text.
 */
import { readFileSync } from 'fs';
import { exit, stderr, stdout } from 'node:process';

const files = [
  'localization/locales/en/agent.json',
  'localization/locales/zh-Hans/agent.json',
  'localization/locales/en/translation.json',
  'localization/locales/zh-Hans/translation.json',
];

let hasErrors = false;

for (const f of files) {
  const text = readFileSync(f, 'utf8');
  /** @type {Map<string, number>[]} */
  const stack = [new Map()]; // each entry = Map<key, firstLine>
  /** @type {string[]} */
  const duplicates = [];
  let inStr = false;
  let strBuf = '';
  let lineNo = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') lineNo++;

    if (inStr) {
      if (ch === '\\') {
        i++; // skip escaped char
        continue;
      }
      if (ch === '"') {
        // end of string — check if it is a key (next non-whitespace is ':')
        const key = strBuf;
        strBuf = '';
        inStr = false;
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        if (text[j] === ':') {
          const cur = stack.at(-1);
          if (!cur) throw new Error('Invalid JSON object nesting');
          if (cur.has(key)) {
            duplicates.push(`  line ${String(lineNo)}: duplicate key "${key}" (first at line ${String(cur.get(key))})`);
          } else {
            cur.set(key, lineNo);
          }
        }
      } else {
        strBuf += ch;
      }
    } else {
      if (ch === '"') {
        inStr = true;
        strBuf = '';
      } else if (ch === '{') {
        stack.push(new Map());
      } else if (ch === '}') {
        stack.pop();
      }
    }
  }

  if (duplicates.length) {
    stdout.write(`\n${f} — ${String(duplicates.length)} duplicate(s):\n`);
    duplicates.forEach(duplicate => {
      stdout.write(`${duplicate}\n`);
    });
    hasErrors = true;
  } else {
    stdout.write(`${f}: OK\n`);
  }
}

if (hasErrors) {
  stderr.write('\nFailed: duplicate keys found in locale files.\n');
  exit(1);
}
