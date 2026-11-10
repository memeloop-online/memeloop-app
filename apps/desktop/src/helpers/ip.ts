import { networkInterfaces } from 'os';

export async function internalIpV4(): Promise<string | undefined> {
  return getAllLocalIpV4()[0] ?? 'localhost';
}

/**
 * Return every usable local IPv4 address. Physical/VPN addresses are preferred
 * over common Docker/WSL/Hyper-V 172.x addresses, which remain as fallbacks.
 */
export function getAllLocalIpV4(): string[] {
  const preferred = new Set<string>();
  const fallback = new Set<string>();
  for (const addresses of Object.values(networkInterfaces())) {
    if (addresses === undefined) continue;
    for (const { address, family, internal } of addresses) {
      if (
        family !== 'IPv4' ||
        internal ||
        address === '0.0.0.0' ||
        address.startsWith('169.254.')
      ) {
        continue;
      }
      (address.startsWith('172.') ? fallback : preferred).add(address);
    }
  }
  return [...preferred, ...fallback];
}
