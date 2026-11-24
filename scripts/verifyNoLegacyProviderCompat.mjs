import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  'apps/desktop/src/services/externalAPI/callProviderAPI.ts',
  'apps/desktop/src/services/providerRegistry/index.ts',
  'apps/desktop/src/services/providerRegistry/callProviderAPI.ts',
  'apps/desktop/src/services/providerRegistry/modelCatalog.ts',
];
const forbidden = [
  { code: 'provider_legacy_tool_id', literal: 'legacy-tool-result-' },
  { code: 'provider_legacy_tool_name', literal: "toolName: 'legacy-tool'" },
  { code: 'provider_tool_id_fallback', pattern: /toolCallId\s*\|\|/u },
  { code: 'provider_legacy_preset', literal: 'legacyPreset' },
];

const trackedFiles = execFileSync('git', ['ls-files', '--', ...targets], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim().split('\n').filter(Boolean).filter((trackedFile) => existsSync(path.join(repositoryRoot, trackedFile)));

const violations = [];
for (const trackedFile of trackedFiles) {
  const source = readFileSync(path.join(repositoryRoot, trackedFile), 'utf8');
  for (const rule of forbidden) {
    const matched = 'literal' in rule ? source.includes(rule.literal) : rule.pattern.test(source);
    if (matched) violations.push(`${rule.code}: ${trackedFile}`);
  }
}

if (violations.length > 0) {
  for (const violation of violations) console.error(`obsolete provider compatibility path: ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`provider compatibility audit passed across ${trackedFiles.length} tracked production files`);
}
