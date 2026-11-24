import assert from 'node:assert/strict';
import test from 'node:test';
import { containedIn, decodeXml, navigationBarFrame, nodeMatches, parseUiXml, visibleNode } from '../nativeAndroidUi.mjs';
import { parseGoalFixture, runNativeGoalChecks } from '../nativeAndroidGoalE2e.mjs';

test('UI XML preserves ancestry, decodes text and parses signed bounds', () => {
  const nodes = parseUiXml('<hierarchy><node text="A &amp; B" bounds="[0,0][1080,2190]"><node text="&#x5DE5;&#20855;" bounds="[-4,12][40,60]" /></node><node text="next" /></hierarchy>');
  assert.equal(nodes[0].text, 'A & B');
  assert.equal(nodes[1].text, '工具');
  assert.deepEqual(nodes[1].rectangle, [-4, 12, 40, 60]);
  assert.equal(nodes[1].parent, 0);
  assert.equal(nodes[2].parent, undefined);
  assert.equal(decodeXml('&lt;&quot;&apos;&gt;'), '<"\'>');
});

test('UIAutomator selectable JSON uses single-quoted attributes containing double quotes', () => {
  const content = '{"content":[{"output":{"type":"text","value":"Wiki搜索完成。\\nResult > 0"},"toolName":"wiki-search","type":"tool-result"}],"role":"tool"}';
  const nodes = parseUiXml(`<node resource-id="prompt-preview-audit-detail" bounds="[44,668][1036,1032]"><node text='${content}' resource-id="" class="android.widget.TextView" package="com.memeloop.mobile" bounds="[44,787][1036,1032]" /></node>`);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[1].text, content);
  assert.equal(nodes[1].package, 'com.memeloop.mobile');
  assert.equal(nodes[1].parent, 0);
  assert.equal(nodes[1].type, undefined);
  assert.ok(visibleNode(nodes, /Wiki搜索完成/, 'com.memeloop.mobile'));
});

test('control lookup selects enabled visible app controls and accessibility labels', () => {
  const nodes = parseUiXml('<node package="other" text="返回" bounds="[0,0][20,20]"/><node package="app" text="返回" enabled="false" bounds="[0,0][20,20]"/><node package="app" text="返回" bounds="[0,0][0,0]"/><node package="app" content-desc="返回" bounds="[10,10][80,80]"/>');
  assert.equal(visibleNode(nodes, '返回', 'app').index, 3);
  assert.equal(visibleNode(nodes, '返回', 'missing'), undefined);
  assert.ok(nodeMatches({ 'resource-id': 'prompt-entry-4' }, /^prompt-entry-/));
});

test('pair controls fit entirely inside the app viewport above system navigation', () => {
  assert.ok(containedIn([20, 2020, 1060, 2160], [0, 72, 1080, 2190]));
  assert.equal(containedIn([20, 2120, 1060, 2250], [0, 72, 1080, 2190]), false);
  assert.equal(containedIn([-1, 20, 60, 40], [0, 0, 1080, 2190]), false);
});

test('touch points respect scroll viewport clipping', () => {
  const nodes = parseUiXml('<node bounds="[0,0][1080,500]"><node package="app" text="partly visible" bounds="[10,450][100,550]"/><node package="app" text="outside" bounds="[10,510][100,550]"/></node>');
  assert.deepEqual(visibleNode(nodes, 'partly visible', 'app').touchRectangle, [10, 450, 100, 500]);
  assert.equal(visibleNode(nodes, 'outside', 'app'), undefined);
});

test('Android 12 navigation window determines the safe bottom for edge-to-edge apps', () => {
  const windows = `
  Window #7 Window{d8c4e19 u0 NavigationBar0}:
    mOwnerUid=1000 showForAllUsers=true package=com.android.systemui appop=NONE
    Frames: containing=[0,2270][1080,2400] parent=[0,2270][1080,2400] display=[0,2270][1080,2400]
    mFrame=[0,2270][1080,2400] last=[0,2270][1080,2400]
    isOnScreen=true
    isVisible=true
  Window #17 Window{e75ae5a u0 com.memeloop.mobile/com.memeloop.mobile.MainActivity}:
    mFrame=[0,0][1080,2400] last=[0,0][1080,2400]
    isOnScreen=true
    isVisible=true
`;
  const frame = navigationBarFrame(windows);
  assert.deepEqual(frame, [0, 2270, 1080, 2400]);
  assert.ok(containedIn([20, 2180, 1060, 2260], [0, 0, 1080, frame[1]]));
  assert.equal(containedIn([20, 2250, 1060, 2390], [0, 0, 1080, frame[1]]), false);
  assert.equal(navigationBarFrame(windows.replace('isVisible=true', 'isVisible=false')), undefined);
  assert.equal(navigationBarFrame(windows.slice(windows.indexOf('  Window #17'))), undefined);
});

test('goal fixture expectations require explicit state and terminal context', () => {
  assert.deepEqual(parseGoalFixture({ objective: 'Plan tomorrow', status: 'completed', round: 3, evidence: 'Verified plan', ignored: true }), {
    objective: 'Plan tomorrow', status: 'completed', round: 3, evidence: 'Verified plan',
  });
  assert.deepEqual(parseGoalFixture({ objective: 'Plan tomorrow', status: 'blocked', round: 2, blockedReason: 'Choose workspace' }), {
    objective: 'Plan tomorrow', status: 'blocked', round: 2, blockedReason: 'Choose workspace',
  });
  for (const value of [null, [], {}, { objective: ' ', status: 'active', round: 1 }, { objective: 'Goal', status: 'unknown', round: 1 },
    { objective: 'Goal', status: 'paused', round: -1 }, { objective: 'Goal', status: 'paused', round: 1.5 },
    { objective: 'Goal', status: 'completed', round: 1 }, { objective: 'Goal', status: 'blocked', round: 1 }]) {
    assert.throws(() => parseGoalFixture(value));
  }
});

test('goal multiline content uses actual visible text, including XML entities and clipping', () => {
  const text = '完成验证：A & B\n保存到知识库 > Calendar';
  const xml = '<node bounds="[0,0][1080,2100]"><node package="com.memeloop.mobile" text="完成验证：A &amp; B&#10;保存到知识库 &gt; Calendar" bounds="[20,1500][1000,2000]"/><node package="com.memeloop.mobile" text="hidden evidence" bounds="[20,2110][1000,2300]"/></node>';
  const nodes = parseUiXml(xml);
  assert.ok(visibleNode(nodes, text, 'com.memeloop.mobile'));
  assert.equal(visibleNode(nodes, 'hidden evidence', 'com.memeloop.mobile'), undefined);
});

test('goal acceptance checks exact content and both return paths without mutating the goal', async () => {
  const fixture = parseGoalFixture({ objective: 'Synthetic goal', status: 'completed', round: 3, evidence: 'Verified result' });
  const calls = [];
  const labels = { title: 'Goal', back: 'Back', description: 'Goal description', status: { completed: 'Completed' }, round: round => `Round ${round}` };
  await runNativeGoalChecks({
    fixture, labels, chatActions: 'Actions', conversationTitle: 'Synthetic conversation',
    step: async (name, action) => { calls.push(['step', name]); await action(); },
    tap: async value => calls.push(['tap', value]),
    expect: async value => calls.push(['expect', value]),
    seek: async value => calls.push(['seek', value]),
    capture: value => calls.push(['capture', value]),
    back: () => calls.push(['back']),
    expectChat: async value => calls.push(['chat', value]),
  });
  assert.deepEqual(calls.filter(([action]) => action === 'step'), [
    ['step', 'goal-01-content'], ['step', 'goal-02-header-return'], ['step', 'goal-03-system-return'],
  ]);
  assert.deepEqual(calls.filter(([action]) => action === 'seek').map(([, value]) => value), ['Completed', 'Round 3', 'Synthetic goal', 'Verified result']);
  assert.deepEqual(calls.filter(([action]) => action === 'tap'), [
    ['tap', 'Actions'], ['tap', 'Goal'], ['tap', 'Back'], ['tap', 'Actions'], ['tap', 'Goal'],
  ]);
  assert.equal(calls.filter(([action]) => action === 'back').length, 1);
  assert.deepEqual(calls.filter(([action]) => action === 'chat'), [['chat', 'Synthetic conversation'], ['chat', 'Synthetic conversation']]);
});

test('goal content assertion failure propagates before claiming successful returns', async () => {
  const steps = [];
  await assert.rejects(runNativeGoalChecks({
    fixture: parseGoalFixture({ objective: 'Synthetic goal', status: 'blocked', round: 1, blockedReason: 'Choose workspace' }),
    labels: { title: 'Goal', back: 'Back', description: 'Description', status: { blocked: 'Needs attention' }, round: round => `Round ${round}` },
    chatActions: 'Actions', conversationTitle: 'Synthetic conversation',
    step: async (name, action) => { steps.push(name); await action(); },
    tap: async () => {}, seek: async () => {}, capture: () => {}, back: () => {},
    expect: async text => { if (text === 'Choose workspace') throw Error('missing rendered reason'); },
    expectChat: async () => { throw Error('unexpected return'); },
  }), /missing rendered reason/);
  assert.deepEqual(steps, ['goal-01-content']);
});
