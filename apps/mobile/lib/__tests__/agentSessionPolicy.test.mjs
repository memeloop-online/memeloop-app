import assert from 'node:assert/strict';
import test from 'node:test';

import { MOBILE_ATTACHMENT_HOST, selectMobileAgentDevice } from '../agentSessionPolicy.ts';

function device(overrides) {
  return {
    displayName: overrides.peerId,
    platform: 'desktop',
    trustMode: 'local-pairing',
    trusted: true,
    reachability: { state: 'online', paths: ['lan'] },
    capabilities: {
      tools: [],
      mcpServers: [],
      hasWiki: false,
      agentLoop: true,
      imChannels: [],
      wikis: [],
    },
    ...overrides,
  };
}

test('selectMobileAgentDevice prefers trusted online Agent peers', () => {
  assert.equal(selectMobileAgentDevice([
    device({ peerId: 'offline', reachability: { state: 'offline', paths: [] } }),
    device({ peerId: 'untrusted', trusted: false }),
    device({ peerId: 'no-agent', capabilities: { tools: [], mcpServers: [], hasWiki: false, agentLoop: false, imChannels: [], wikis: [] } }),
    device({ peerId: 'eligible' }),
  ])?.peerId, 'eligible');
});

test('restored trusted desktops remain reconnectable before capabilities are discovered', () => {
  const restored = device({ peerId: 'restored', reachability: { state: 'offline', paths: [] },
    capabilities: { tools: [], mcpServers: [], hasWiki: false, agentLoop: false, imChannels: [], wikis: [] } });
  assert.equal(selectMobileAgentDevice([restored])?.peerId, 'restored');
  assert.equal(selectMobileAgentDevice([{ ...restored, trusted: false }]), undefined);
});

test('selectMobileAgentDevice is deterministic and prefers online over nearby', () => {
  assert.equal(selectMobileAgentDevice([
    device({ peerId: 'recent-nearby', lastSeen: 20, reachability: { state: 'nearby', paths: ['lan'] } }),
    device({ peerId: 'older-online', lastSeen: 10 }),
  ])?.peerId, 'older-online');
  assert.equal(selectMobileAgentDevice([
    device({ peerId: 'b', lastSeen: 10 }),
    device({ peerId: 'a', lastSeen: 10 }),
  ])?.peerId, 'a');
});

test('selects on Hermes without toSorted and preserves the source device order', () => {
  const original = Object.getOwnPropertyDescriptor(Array.prototype, 'toSorted');
  Object.defineProperty(Array.prototype, 'toSorted', { configurable: true, value: undefined });
  try {
    const devices = Object.freeze([device({ peerId: 'b' }), device({ peerId: 'a' })]);
    assert.equal(selectMobileAgentDevice(devices)?.peerId, 'a');
    assert.deepEqual(devices.map(item => item.peerId), ['b', 'a']);
  } finally {
    if (original) Object.defineProperty(Array.prototype, 'toSorted', original);
    else delete Array.prototype.toSorted;
  }
});

test('attachment capability is hidden and rejects metadata fail closed', () => {
  assert.equal(MOBILE_ATTACHMENT_HOST.supported, false);
  assert.equal(MOBILE_ATTACHMENT_HOST.attachmentActionsVisible, false);
  const controller = new AbortController();
  assert.deepEqual(
    MOBILE_ATTACHMENT_HOST.prepareSendMessage({ text: 'hello' }, { signal: controller.signal }),
    { text: 'hello' },
  );
  assert.throws(
    () => MOBILE_ATTACHMENT_HOST.prepareSendMessage({
      text: 'hello',
      wikiTiddlers: [{ workspaceName: 'forbidden', tiddlerTitle: 'attachment' }],
    }, { signal: controller.signal }),
    /mobile_attachments_not_supported/u,
  );
  assert.throws(
    () => MOBILE_ATTACHMENT_HOST.prepareSendMessage({
      text: 'hello',
      futureAttachmentContract: [{ uri: 'file:///not-owned-by-this-host' }],
    }, { signal: controller.signal }),
    /mobile_attachments_not_supported/u,
  );
});

test('attachment preparation observes cancellation', () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  assert.throws(
    () => MOBILE_ATTACHMENT_HOST.prepareSendMessage({ text: 'hello' }, { signal: controller.signal }),
    /cancelled/u,
  );
});
