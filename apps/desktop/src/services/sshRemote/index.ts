import { bootstrapRemoteCli, type RemoteBootstrapEvidence } from 'memeloop-cli';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Remote onboarding is deliberately immutable until the next reviewed release. */
export const MEMELOOP_REMOTE_BOOTSTRAP_VERSION = '0.2.7';

export interface SSHHost {
  host: string;
  hostname?: string;
  user?: string;
  port?: number;
  identityFile?: string;
}

export function parseSSHConfig(): SSHHost[] {
  const sshConfigPath = path.join(os.homedir(), '.ssh', 'config');
  if (!fs.existsSync(sshConfigPath)) return [];

  const hosts: SSHHost[] = [];
  let current: Partial<SSHHost> | null = null;
  for (const line of fs.readFileSync(sshConfigPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(\S+)\s+(.+)$/);
    if (!match) continue;
    const [, rawKey, value] = match;
    const key = rawKey.toLowerCase();
    if (key === 'host') {
      if (current?.host) hosts.push(current as SSHHost);
      current = { host: value };
      continue;
    }
    if (!current) continue;
    if (key === 'hostname') current.hostname = value;
    else if (key === 'user') current.user = value;
    else if (key === 'port') current.port = Number.parseInt(value, 10);
    else if (key === 'identityfile') {
      current.identityFile = value.startsWith('~/')
        ? path.join(os.homedir(), value.slice(2))
        : value;
    }
  }
  if (current?.host) hosts.push(current as SSHHost);
  return hosts.filter((host) =>
    !host.host.includes('*') &&
    !host.host.includes('?') &&
    (!host.port || Number.isSafeInteger(host.port))
  );
}

function targetFor(host: SSHHost): string {
  return host.user ? `${host.user}@${host.host}` : host.host;
}

export async function bootstrapRemote(
  host: SSHHost,
  options: { dryRun: boolean; acceptNewHostKey: boolean },
): Promise<RemoteBootstrapEvidence> {
  return bootstrapRemoteCli({
    target: targetFor(host),
    version: MEMELOOP_REMOTE_BOOTSTRAP_VERSION,
    port: host.port ?? 22,
    identityFile: host.identityFile,
    hostKeyPolicy: options.acceptNewHostKey ? 'accept-new' : 'strict',
    dryRun: options.dryRun,
  });
}
