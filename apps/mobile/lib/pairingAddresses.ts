/** Restore WebSocket destinations from the peer's authenticated pairing record. */
export function pairingBootstrapAddresses(peerId: string, stored: unknown): string[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter((address): address is string =>
    typeof address === 'string' && /\/wss?(?:\/|$)/u.test(address)
  ).flatMap(address => {
    const target = /\/p2p\/([^/]+)$/u.exec(address)?.[1];
    if (target) return target === peerId ? [address] : [];
    return [`${address}/p2p/${peerId}`];
  });
}
