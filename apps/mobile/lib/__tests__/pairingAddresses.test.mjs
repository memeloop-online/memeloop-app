import assert from 'node:assert/strict';
import test from 'node:test';
import { pairingBootstrapAddresses } from '../pairingAddresses.ts';

test('restores raw paired WebSocket addresses with the authenticated peer identity', () => {
  assert.deepEqual(pairingBootstrapAddresses('desktop', [
    '/ip4/192.168.1.2/tcp/32562',
    '/ip4/192.168.1.2/tcp/32563/ws',
    '/dns4/example.com/tcp/443/wss/p2p/desktop',
    '/dns4/relay.example.com/tcp/443/wss/p2p/relay/p2p-circuit',
    '/dns4/other.example.com/tcp/443/wss/p2p/other',
  ]), [
    '/ip4/192.168.1.2/tcp/32563/ws/p2p/desktop',
    '/dns4/example.com/tcp/443/wss/p2p/desktop',
    '/dns4/relay.example.com/tcp/443/wss/p2p/relay/p2p-circuit/p2p/desktop',
  ]);
  assert.deepEqual(pairingBootstrapAddresses('desktop', null), []);
});
