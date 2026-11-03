import { bootstrapRemoteCli, MEMELOOP_CLI_VERSION, type RemoteBootstrapEvidence } from 'memeloop-cli';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The installed CLI release is the single source of truth for remote bootstrap. */
export const MEMELOOP_REMOTE_BOOTSTRAP_VERSION = MEMELOOP_CLI_VERSION;

export interface SSHHost {
  host: string;
  hostname?: string;
  user?: string;
  port?: number;
  identityFile?: string;
}

const concreteHostPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,251}$/u;

function expandHostPatterns(value: string): string[] {
  return value
    .split(/\s+/u)
    .map(host => host.trim())
    .filter(host => concreteHostPattern.test(host));
}

export function parseSSHConfig(): SSHHost[] {
  const sshConfigPath = path.join(os.homedir(), '.ssh', 'config');
  if (!fs.existsSync(sshConfigPath)) return [];

  const hosts: SSHHost[] = [];
  let current: SSHHost[] = [];
  const flush = (): void => {
    hosts.push(...current);
    current = [];
  };

  for (const line of fs.readFileSync(sshConfigPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^(\S+)\s+(.+)$/u.exec(trimmed);
    if (!match) continue;
    const [, rawKey, value] = match;
    const key = rawKey.toLowerCase();
    if (key === 'host') {
      flush();
      current = expandHostPatterns(value).map(host => ({ host }));
      continue;
    }
    if (current.length === 0) continue;
    if (key === 'hostname' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,251}$/u.test(value)) {
      current.forEach(host => {
        host.hostname = value;
      });
    } else if (key === 'user' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value)) {
      current.forEach(host => {
        host.user = value;
      });
    } else if (key === 'port') {
      const port = Number.parseInt(value, 10);
      if (Number.isSafeInteger(port) && port >= 1 && port <= 65_535) {
        current.forEach(host => {
          host.port = port;
        });
      }
    } else if (key === 'identityfile' && value.length <= 4_096 && !value.includes('\0')) {
      const identityFile = value.startsWith('~/')
        ? path.join(os.homedir(), value.slice(2))
        : value;
      current.forEach(host => {
        host.identityFile = identityFile;
      });
    }
  }
  flush();
  return hosts;
}

function targetFor(host: SSHHost): string {
  return host.user ? `${host.user}@${host.host}` : host.host;
}

export async function bootstrapRemote(
  host: SSHHost,
  options: { dryRun: boolean; acceptNewHostKey: boolean },
): Promise<RemoteBootstrapEvidence> {
  if (!concreteHostPattern.test(host.host)) {
    throw new Error('SSH host must be a concrete alias without shell syntax');
  }
  return bootstrapRemoteCli({
    target: targetFor(host),
    version: MEMELOOP_REMOTE_BOOTSTRAP_VERSION,
    port: host.port ?? 22,
    identityFile: host.identityFile,
    hostKeyPolicy: options.acceptNewHostKey ? 'accept-new' : 'strict',
    dryRun: options.dryRun,
  });
}
