import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { getMobileLabels } from '../apps/mobile/lib/i18n.ts';
import { containedIn, navigationBarFrame, nodeMatches, parseUiXml, visibleNode } from './nativeAndroidUi.mjs';

const { values } = parseArgs({
  options: {
    serial: { type: 'string', default: process.env.ANDROID_SERIAL },
    output: { type: 'string' },
    locale: { type: 'string', default: 'zh-Hans' },
    'conversation-title': { type: 'string' },
    'final-text': { type: 'string' },
    'tool-name': { type: 'string', default: 'wiki-search' },
    'tool-result-text': { type: 'string' },
    'model-name': { type: 'string', default: 'GPT-6.1 Sol' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log('node --experimental-strip-types scripts/nativeAndroidE2e.mjs --serial DEVICE --output DIRECTORY --conversation-title TITLE --final-text MARKER --tool-result-text RESULT_MARKER [--locale zh-Hans] [--tool-name wiki-search] [--model-name "GPT-6.1 Sol"]');
  console.log('Requires an installed, paired com.memeloop.mobile and a preselected main fixture with two consecutive tool calls. Captures screenshots/XML/report; preserves pairing and conversation content.');
  process.exit(0);
}
for (const name of ['serial', 'output', 'conversation-title', 'final-text', 'tool-result-text']) assert.ok(values[name], `Required option: --${name}`);
const packageName = 'com.memeloop.mobile';
const output = path.resolve(values.output);
mkdirSync(output, { recursive: true });
const labels = getMobileLabels(values.locale);
const report = { packageName, serial: values.serial, startedAt: new Date().toISOString(), steps: [], passed: false };
const remoteXml = '/sdcard/memeloop-native-e2e.xml';
const adb = (...args) => execFileSync('adb', ['-s', values.serial, ...args], {
  timeout: 20000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});
let currentXml = '';
const dump = () => {
  adb('shell', 'uiautomator', 'dump', remoteXml);
  currentXml = adb('exec-out', 'cat', remoteXml).toString();
  return parseUiXml(currentXml);
};
const hasText = (nodes, text) => nodes.some(node => node.package === packageName
  && [node.text, node['content-desc']].some(value => value?.includes(text)));
const waitFor = async (predicate, description) => {
  const deadline = Date.now() + 30000;
  let nodes;
  do {
    nodes = dump();
    if (predicate(nodes)) return nodes;
    await delay(400);
  } while (Date.now() < deadline);
  throw Error(`Timed out: ${description}. Visible text: ${nodes.filter(node => node.text).map(node => node.text.slice(0, 100)).join(' | ')}`);
};
const expect = label => waitFor(nodes => visibleNode(nodes, label, packageName), `visible ${label}`);
const expectText = text => waitFor(nodes => hasText(nodes, text), `text ${text}`);
const tap = async label => {
  let previous;
  const nodes = await waitFor(candidate => {
    const node = visibleNode(candidate, label, packageName);
    const bounds = node?.touchRectangle.join(',');
    const stable = bounds && bounds === previous;
    previous = bounds;
    return stable;
  }, `stable control ${label}`);
  const [left, top, right, bottom] = visibleNode(nodes, label, packageName).touchRectangle;
  adb('shell', 'input', 'tap', String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
};
const back = () => adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
const seek = async label => {
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const nodes = dump();
    if (visibleNode(nodes, label, packageName)) return;
    const viewport = nodes.find(node => node.package === packageName && node.scrollable === 'true')?.rectangle;
    assert.ok(viewport, `Scrollable viewport for ${label}`);
    const [left, top, right, bottom] = viewport;
    const x = Math.round((left + right) / 2);
    adb('shell', 'input', 'swipe', String(x), String(Math.round(bottom - (bottom - top) * 0.2)),
      String(x), String(Math.round(top + (bottom - top) * 0.25)), '350');
    await delay(400);
  }
  throw Error(`Scrolled to end while seeking ${label}`);
};
const capture = name => {
  const artifact = { name, xml: path.join(output, `${name}.xml`), screenshot: path.join(output, `${name}.png`) };
  writeFileSync(artifact.xml, currentXml);
  writeFileSync(artifact.screenshot, adb('exec-out', 'screencap', '-p'));
  report.artifacts ??= [];
  report.artifacts.push(artifact);
  return artifact;
};
const expectDetail = async text => {
  await waitFor(nodes => visibleNode(nodes, 'prompt-preview-audit-detail', packageName)
    && visibleNode(nodes, 'prompt-preview-detail-back', packageName)
    && !visibleNode(nodes, labels.chat.inspection.loading, packageName)
    && !visibleNode(nodes, labels.chat.inspection.error, packageName),
  'loaded prompt detail');
  // UIAutomator encloses selectable JSON text in single quotes; parseUiXml
  // preserves that text for content assertions. Screenshots also capture its visual layout.
  await expectText(text);
};
const assertAboveNavigation = (node, evidenceName) => {
  const windows = adb('shell', 'dumpsys', 'window', 'windows').toString();
  const navigation = navigationBarFrame(windows);
  writeFileSync(path.join(output, `${evidenceName}-windows.txt`), windows);
  assert.ok(navigation, 'Visible system NavigationBar frame');
  assert.ok(node.rectangle[3] <= navigation[1],
    `${evidenceName} bottom ${node.rectangle[3]} fits above system navigation ${navigation[1]}`);
  report.safeAreas ??= [];
  report.safeAreas.push({ name: evidenceName, control: node.rectangle, navigation });
};
const step = async (name, action) => {
  const startedAt = Date.now();
  try {
    await action();
    dump();
    capture(name);
    report.steps.push({ name, passed: true, durationMs: Date.now() - startedAt });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.steps.push({ name, passed: false, error: String(error), durationMs: Date.now() - startedAt });
    try { dump(); capture(`${name}-failure`); } catch { /* The original step error remains in the report. */ }
    throw error;
  } finally {
    writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
};
try {
  report.installation = adb('shell', 'dumpsys', 'package', packageName).toString().split('\n')
    .filter(line => /versionName=|versionCode=|lastUpdateTime=/.test(line)).map(line => line.trim());
  await step('01-home', async () => {
    adb('shell', 'am', 'start', '-n', `${packageName}/.MainActivity`);
    await waitFor(nodes => nodes.some(node => node.package === packageName), 'app foreground');
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const nodes = dump();
      if ([labels.home.chatTitle, labels.home.nodesTitle, labels.home.settingsTitle]
        .every(label => visibleNode(nodes, label, packageName))) break;
      back();
      await delay(400);
    }
    await expect(labels.home.chatTitle);
    await expect(labels.home.nodesTitle);
    await expect(labels.home.settingsTitle);
  });
  await step('02-pairing-control', async () => {
    await tap(labels.home.nodesTitle);
    const nodes = await expect(labels.nodes.pairDesktop);
    const button = visibleNode(nodes, labels.nodes.pairDesktop, packageName);
    const appViewport = nodes.find(node => node.package === packageName)?.rectangle;
    assert.ok(containedIn(button.rectangle, appViewport), 'Pair button fits app viewport');
    const image = adb('exec-out', 'screencap', '-p');
    assert.ok(containedIn(button.rectangle, [0, 0, image.readUInt32BE(16), image.readUInt32BE(20)]));
    // Paper's text node may be nested inside the actual touchable button.
    let control = button;
    while (control.clickable !== 'true' && control.parent !== undefined) control = nodes[control.parent];
    assertAboveNavigation(control, '02-pair-button');
    capture('02-nodes-pair-button');
    await tap(labels.nodes.pairDesktop);
    await expect(labels.nodes.pairingInvitation);
    await tap(labels.nodes.cancel);
    await expect(labels.nodes.pairDesktop);
    back();
    await expect(labels.home.chatTitle);
  });
  await step('03-paired-main-chat', async () => {
    await tap(labels.home.chatTitle);
    await expectText(values['conversation-title']);
    await expectText(values['final-text']);
    const nodes = await expect(labels.chat.completedWork(2));
    assert.equal(nodes.some(node => nodeMatches(node, values['tool-name'])), false, 'Work starts collapsed');
    const composer = nodes.find(node => node.package === packageName && node.class === 'android.widget.EditText');
    assert.ok(composer, 'Chat composer is present');
    assertAboveNavigation(composer, '03-chat-composer');
  });
  await step('04-work-group', async () => {
    await tap(labels.chat.completedWork(2));
    await expect(`▸ ${labels.chat.toolGroup(2)}`);
  });
  await step('05-tool-group', async () => {
    await tap(labels.chat.toolGroup(2));
    await expect(values['tool-name']);
  });
  await step('06-tool-content', async () => {
    await tap(values['tool-name']);
    await expectText(values['tool-result-text']);
    await expect(labels.chat.toolInput);
  });
  await step('07-model-parameters', async () => {
    await tap(labels.chat.actions);
    await tap(labels.chat.parameters);
    await expectText(values['model-name']);
    await expect(labels.chat.modelParameters.reasoningEffort);
    capture('07-model-fields');
    back();
    await expect(labels.chat.actions);
  });
  await step('08-prompt-tree', async () => {
    await tap(labels.chat.actions);
    await tap(labels.chat.prompt);
    await expect(labels.chat.inspection.tree);
    const group = `▾ ${labels.chat.inspection.source('prompt')}`;
    const nodes = await expect(group);
    assert.ok(visibleNode(nodes, group, packageName));
    await tap(group);
    await seek(`${labels.chat.inspection.role('tool')} · ${labels.chat.inspection.source('tool')}`);
  });
  await step('09-prompt-tool-return', async () => {
    await tap(`${labels.chat.inspection.role('tool')} · ${labels.chat.inspection.source('tool')}`);
    await expectDetail(values['tool-result-text']);
    capture('09-prompt-tool-detail');
    back();
    await expect(`${labels.chat.inspection.role('tool')} · ${labels.chat.inspection.source('tool')}`);
  });
  await step('10-prompt-flat', async () => {
    // Return to the top so the inspector tabs stay within the touch viewport.
    const nodes = dump();
    const viewport = nodes.find(node => node.package === packageName && node.scrollable === 'true')?.rectangle;
    if (viewport) {
      const [left, top, right, bottom] = viewport;
      for (let count = 0; count < 5; count += 1) {
        adb('shell', 'input', 'swipe', String(Math.round((left + right) / 2)), String(top + 80),
          String(Math.round((left + right) / 2)), String(bottom - 80), '200');
      }
    }
    await tap(labels.chat.inspection.flat);
    await seek(`${labels.chat.inspection.role('tool')} · ${labels.chat.inspection.source('tool')}`);
  });
  await step('11-model-request-return', async () => {
    back();
    await expect(labels.chat.actions);
    await tap(labels.chat.actions);
    await tap(labels.chat.prompt);
    await tap('prompt-preview-model-request-detail');
    await expectDetail(values['tool-name']);
    capture('11-model-request-detail');
    back();
    await expect(`▾ ${labels.chat.inspection.source('prompt')}`);
    back();
    await expect(labels.chat.actions);
  });
  report.passed = true;
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  try { adb('shell', 'rm', '-f', remoteXml); } catch (error) { console.error(`UI dump cleanup: ${error}`); }
}
