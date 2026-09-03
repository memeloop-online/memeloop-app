import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Keep this list focused on the App's canonical contract boundaries.  The
// physical SQL adapters may retain storage-only names (for example
// `scheduleKind` and `updated`), while public service/UI contracts must use
// Core's definitions directly.
const productionTargets = [
  'apps/desktop/src/services/agentDefinition/interface.ts',
  'apps/desktop/src/services/agentDefinition/builtinAgentDefinitions.ts',
  'apps/desktop/src/services/agentDefinition/index.ts',
  'apps/desktop/src/services/database/schema/agent.ts',
  'apps/desktop/src/services/agentInstance/interface.ts',
  'apps/desktop/src/services/agentInstance/utilities.ts',
  'apps/desktop/src/services/agentInstance/agentRepository.ts',
  'apps/desktop/src/services/agentInstance/scheduledTaskTypes.ts',
  'apps/desktop/src/services/agentInstance/scheduledTaskManager.ts',
  'apps/desktop/src/services/agentInstance/scheduledTaskRpcStore.ts',
  'apps/desktop/src/services/agentInstance/index.ts',
  'apps/desktop/src/services/agentInstance/memeloopWorker.ts',
  'apps/desktop/src/services/agentInstance/conversationMutationObserver.ts',
  'apps/desktop/src/pages/Agent/TabContent/TabTypes/ScheduledWakeupEditor.tsx',
  'apps/desktop/src/pages/Agent/components/TabBar/TabListDropdown.tsx',
];

const coreImportRequirements = [
  ['apps/desktop/src/services/agentDefinition/interface.ts', /\bAgentDefinition\b/u],
  ['apps/desktop/src/services/agentDefinition/builtinAgentDefinitions.ts', /\bgetBuiltinLoopProfiles\b/u],
  ['apps/desktop/src/services/agentDefinition/index.ts', /\bAgentDefinition\b/u],
  ['apps/desktop/src/services/database/schema/agent.ts', /\bAgentInstanceMetadata\b/u],
  ['apps/desktop/src/services/agentInstance/interface.ts', /\bAgentInstanceModel\b.*\bAgentInstanceMetadata\b/su],
  ['apps/desktop/src/services/agentInstance/utilities.ts', /\bcreateChatMessage\b/u],
  ['apps/desktop/src/services/agentInstance/agentRepository.ts', /\bmaterializeAgentInstanceModel\b/u],
  ['apps/desktop/src/services/agentInstance/scheduledTaskTypes.ts', /\bCoreScheduledTask\b/u],
  ['apps/desktop/src/services/agentInstance/scheduledTaskManager.ts', /\bScheduledTaskExecutionCoordinator\b/u],
  ['apps/desktop/src/services/agentInstance/scheduledTaskRpcStore.ts', /\bcreateScheduledTaskRpcHandler\b/u],
  ['apps/desktop/src/services/agentInstance/index.ts', /\bcreateChatMessage\b/u],
  ['apps/desktop/src/services/agentInstance/memeloopWorker.ts', /\bcreateAgentRuntimeDeviceRpcHandler\b/u],
  ['apps/desktop/src/pages/Agent/TabContent/TabTypes/ScheduledWakeupEditor.tsx', /\bCoreAgentDefinition\b/u],
  ['apps/desktop/src/pages/Agent/components/TabBar/TabListDropdown.tsx', /\bScheduledTask\b/u],
];

const legacySymbols = [
  'aiApiConfig',
  'AiAPIConfig',
  'AgentToolConfig',
  'AtSchedule',
  'CronSchedule',
  'scheduledAlarm',
  'SetBackgroundAlarmInput',
  'AgentBackgroundTask',
  'getBackgroundTasks',
  'setBackgroundAlarm',
  'cancelBackgroundTask',
  'scheduleAlarmTimer',
  'getActiveAlarmEntries',
  'cancelAlarm',
  'LegacyAgentMessagePageOptions',
];

const duplicateContractPattern = /(?:^|\n)\s*(?:(?:export|declare)\s+)?(?:interface\s+(?:AgentDefinition|AgentInstance|AgentInstanceMessage|ScheduledTask)\b|type\s+(?:AgentDefinition|AgentInstance|AgentInstanceMessage|ScheduledTask)\s*=)/gu;
const legacyConversionPattern = /\b(?:to|from)(?:AgentDefinition|AgentInstance|AgentMessage|ScheduledTask)\b/gu;
const unsafeAssertionPattern = /\bas\s+unknown\s+as\b|\bas\s+never\b|\bas\s+any\b|<any>/gu;
// Keep comment-only handlers in the same category as genuinely empty
// handlers.  The source is comment-stripped before this expression runs so
// diagnostics still point at the original offset while `catch { /* why */ }`
// cannot evade the audit.  The tiny lexer below deliberately preserves
// strings/templates and line breaks; a regex that removes comments directly
// would corrupt string literals and make false positives likely.
const silentCatchPattern = /catch(?:\s*\([^)]*\))?\s*\{\s*\}|\.catch\(\s*(?:(?:(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)|(?:(?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?\s*\([^)]*\)))\s*\{\s*\}\s*\)/gu;

function stripCommentsPreservingOffsets(source) {
  // `split('')` keeps UTF-16 code-unit offsets aligned with RegExp indices;
  // spreading by code point would shift diagnostics after astral characters.
  const output = source.split('');
  let index = 0;

  // Scan JavaScript code while preserving template-literal interpolation
  // expressions.  A flat quote state would treat `${ ... }` as data and miss
  // a real catch inside the expression; recursive scanning keeps literal text
  // intact while still removing comments from executable interpolation code.
  const scanTemplate = () => {
    index += 1; // opening backtick
    while (index < source.length) {
      const character = source[index];
      if (character === '\\') {
        index += 2;
        continue;
      }
      if (character === '`') {
        index += 1;
        return;
      }
      if (character === '$' && source[index + 1] === '{') {
        index += 2;
        scanCode(true);
        continue;
      }
      index += 1;
    }
  };

  const scanCode = (stopAtBrace = false) => {
    let braceDepth = stopAtBrace ? 1 : 0;
    while (index < source.length) {
      const character = source[index];
      if (character === '\\') {
        index += 2;
        continue;
      }
      if (character === '"' || character === "'") {
        const quote = character;
        index += 1;
        while (index < source.length) {
          if (source[index] === '\\') {
            index += 2;
            continue;
          }
          if (source[index] === quote) {
            index += 1;
            break;
          }
          index += 1;
        }
        continue;
      }
      if (character === '`') {
        scanTemplate();
        continue;
      }
      if (stopAtBrace && character === '{') {
        braceDepth += 1;
        index += 1;
        continue;
      }
      if (stopAtBrace && character === '}') {
        braceDepth -= 1;
        index += 1;
        if (braceDepth === 0) return;
        continue;
      }
      if (character === '/' && source[index + 1] === '/') {
        output[index] = ' ';
        output[index + 1] = ' ';
        index += 2;
        while (index < source.length && source[index] !== '\n') {
          output[index] = ' ';
          index += 1;
        }
        continue;
      }
      if (character === '/' && source[index + 1] === '*') {
        output[index] = ' ';
        output[index + 1] = ' ';
        index += 2;
        while (index < source.length) {
          if (source[index] === '*' && source[index + 1] === '/') {
            output[index] = ' ';
            output[index + 1] = ' ';
            index += 2;
            break;
          }
          if (source[index] !== '\n' && source[index] !== '\r') output[index] = ' ';
          index += 1;
        }
        continue;
      }
      index += 1;
    }
  };

  scanCode();
  return output.join('');
}

function hasSilentCatch(source) {
  silentCatchPattern.lastIndex = 0;
  return silentCatchPattern.test(stripCommentsPreservingOffsets(source));
}

if (process.argv.includes('--self-test')) {
  const fixtures = [
    ['catch block with a comment', 'try {} catch (error) { /* expected fallback */ }', true],
    ['arrow rejection with a comment', 'Promise.resolve().catch(async () => { // expected fallback\n})', true],
    ['function rejection with a comment', 'Promise.resolve().catch(function onFailure() { /* expected fallback */ })', true],
    ['catch with executable handling', 'try {} catch (error) { report(error); }', false],
    ['literal text is not executable code', 'const text = `catch { /* not code */ }`;', false],
    ['template interpolation remains executable code', 'const value = `${(() => { try {} catch { /* executable */ } })()}`;', true],
  ];
  for (const [label, source, expected] of fixtures) {
    assert.equal(hasSilentCatch(source), expected, label);
  }
  console.log(`canonical agent contract scanner self-test passed (${fixtures.length} fixtures)`);
  process.exit(0);
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function trackedTargets() {
  const output = execFileSync('git', ['ls-files', '--', ...productionTargets], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  return output.split('\n').filter(Boolean);
}

function trackedProductionSources() {
  const output = execFileSync(
    'git',
    ['ls-files', '--', 'apps/desktop/src', 'apps/desktop/features', 'apps/mobile/app', 'apps/mobile/lib'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  return output.split('\n').filter(target =>
    /\.(?:js|mjs|ts|tsx)$/u.test(target) &&
    !/(?:^|\/)__tests__(?:\/|$)/u.test(target) &&
    !/(?:\.test|\.spec|\.stories)\.[cm]?[jt]sx?$/u.test(target) &&
    existsSync(path.join(repositoryRoot, target))
  );
}

const trackedFiles = trackedTargets();
const allProductionFiles = trackedProductionSources();
const violations = [];
const sourceByFile = new Map();
for (const target of productionTargets) {
  if (!trackedFiles.includes(target)) {
    violations.push(`missing tracked production target: ${target}`);
    continue;
  }
  sourceByFile.set(target, readFileSync(path.join(repositoryRoot, target), 'utf8'));
}


for (const target of allProductionFiles) {
  const source = sourceByFile.get(target) ?? readFileSync(path.join(repositoryRoot, target), 'utf8');
  const scanSource = stripCommentsPreservingOffsets(source);
  for (const [pattern, label] of [
    [unsafeAssertionPattern, 'unsafe assertion'],
    [silentCatchPattern, 'silent empty catch'],
  ]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(pattern === silentCatchPattern ? scanSource : source)) !== null) {
      violations.push(`${label}: ${target}:${lineNumber(source, match.index)}`);
    }
  }
}

for (const [target, source] of sourceByFile) {
  for (const pattern of [unsafeAssertionPattern, legacyConversionPattern, duplicateContractPattern]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      // Re-export aliases are the intended bridge to Core and are not local
      // DTO declarations. Object/interface declarations remain violations.
      if (pattern === duplicateContractPattern) {
        const lineEnd = source.indexOf('\n', match.index + 1);
        const declarationLine = source.slice(match.index, lineEnd === -1 ? source.length : lineEnd);
        if (/\btype\s+(?:AgentDefinition|AgentInstance|AgentInstanceMessage|ScheduledTask)\s*=\s*(?:AgentInstanceModel|ChatMessage|CoreScheduledTask|CoreAgentDefinition)\b/u.test(declarationLine)) {
          continue;
        }
      }
      const label = pattern === unsafeAssertionPattern
        ? 'unsafe assertion'
        : pattern === legacyConversionPattern
        ? 'legacy local conversion helper'
        : 'local canonical DTO declaration';
      violations.push(`${label}: ${target}:${lineNumber(source, match.index)}`);
    }
  }
  for (const symbol of legacySymbols) {
    const pattern = new RegExp(`\\b${symbol}\\b`, 'gu');
    const match = pattern.exec(source);
    if (match) violations.push(`legacy symbol ${symbol}: ${target}:${lineNumber(source, match.index)}`);
  }
}

for (const [target, evidencePattern] of coreImportRequirements) {
  const source = sourceByFile.get(target);
  if (!source) continue;
  if (!/from\s+['"]memeloop['"]/u.test(source)) {
    violations.push(`missing direct Core import: ${target}`);
  }
  if (!evidencePattern.test(source)) {
    violations.push(`missing Core contract alias/evidence: ${target}`);
  }
}

if (violations.length > 0) {
  for (const violation of violations) console.error(`canonical agent contract violation: ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `canonical agent contract audit passed across ${allProductionFiles.length} App production files ` +
      `(${trackedFiles.length} canonical agent boundaries)`,
  );
}
