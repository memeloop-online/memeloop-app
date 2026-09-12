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

test('selectMobileAgentDevice only selects trusted reachable Agent peers', () => {
  assert.equal(selectMobileAgentDevice([
    device({ peerId: 'offline', reachability: { state: 'offline', paths: [] } }),
    device({ peerId: 'untrusted', trusted: false }),
    device({ peerId: 'no-agent', capabilities: { tools: [], mcpServers: [], hasWiki: false, agentLoop: false, imChannels: [], wikis: [] } }),
    device({ peerId: 'eligible' }),
  ])?.peerId, 'eligible');
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
