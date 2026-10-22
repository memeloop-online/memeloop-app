import { describe, expect, it } from 'vitest';
import { selectPairingAddresses } from '../pairingAddresses';

describe('Desktop pairing address selection', () => {
  it('keeps browser paths within the invite limit on a host with five interfaces', () => {
    const interfaces = ['100.64.0.2', '192.168.1.48', '127.0.0.1', '192.168.128.1', '172.23.0.1'];
    const tcp = interfaces.map(ip => `/ip4/${ip}/tcp/12363/p2p/peer`);
    const webSocket = interfaces.map(ip => `/ip4/${ip}/tcp/12364/ws/p2p/peer`);
    const selected = selectPairingAddresses([...tcp, ...webSocket, ...webSocket]);
    expect(selected).toHaveLength(8);
    expect(selected.slice(0, 5)).toEqual(webSocket);
    expect(selected.slice(5)).toEqual(tcp.slice(0, 3));
  });
});
