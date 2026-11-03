import assert from 'node:assert/strict';
import test from 'node:test';
import { containedIn, decodeXml, navigationBarFrame, nodeMatches, parseUiXml, visibleNode } from '../nativeAndroidUi.mjs';

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
