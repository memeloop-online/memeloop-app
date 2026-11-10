/** Pairing invites permit eight addresses; retain browser-compatible paths first. */
export function selectPairingAddresses(addresses: readonly string[]): string[] {
  return [...new Set(addresses)]
    .sort((left, right) => Number(right.includes('/ws/')) - Number(left.includes('/ws/')))
    .slice(0, 8);
}
