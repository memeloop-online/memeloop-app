import { exec } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface SSHHost {
  host: string;
  hostname?: string;
  user?: string;
  port?: number;
  identityFile?: string;
}

/**
 * Parse ~/.ssh/config and return available hosts
 */
export function parseSSHConfig(): SSHHost[] {
  const sshConfigPath = path.join(os.homedir(), '.ssh', 'config');
  if (!fs.existsSync(sshConfigPath)) return [];

  const content = fs.readFileSync(sshConfigPath, 'utf-8');
  const hosts: SSHHost[] = [];
  let current: Partial<SSHHost> | null = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^(\S+)\s+(.+)$/);
    if (!match) continue;

    const [, key, value] = match;
    const lowerKey = key.toLowerCase();

    if (lowerKey === 'host') {
      if (current?.host) hosts.push(current as SSHHost);
      current = { host: value };
    } else if (current) {
      switch (lowerKey) {
        case 'hostname': current.hostname = value; break;
        case 'user': current.user = value; break;
        case 'port': current.port = parseInt(value, 10); break;
        case 'identityfile': current.identityFile = value.replace('~', os.homedir()); break;
      }
    }
  }
  if (current?.host) hosts.push(current as SSHHost);

  // Filter out wildcard hosts
  return hosts.filter(h => !h.host.includes('*') && !h.host.includes('?'));
}

/**
 * Execute a command on a remote server via SSH
 */
export async function sshExec(host: SSHHost, command: string, timeoutMs = 30000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const args: string[] = [];
  if (host.port) args.push('-p', String(host.port));
  if (host.identityFile) args.push('-i', `"${host.identityFile}"`);

  // StrictHostKeyChecking=no for first connection, ConnectTimeout=10
  const sshArgs = [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=10',
    ...args,
    `${host.user ?? 'root'}@${host.hostname ?? host.host}`,
    `"${command}"`,
  ];

  const sshCmd = `ssh ${sshArgs.join(' ')}`;

  try {
    const { stdout, stderr } = await execAsync(sshCmd, {
      timeout: timeoutMs,
      windowsHide: true,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: (err.stdout ?? '').trim(),
      stderr: (err.stderr ?? '').trim(),
      exitCode: err.code ?? 1,
    };
  }
}

/**
 * Check if memeloop CLI is installed on a remote server
 */
export async function checkRemoteMemeloop(host: SSHHost): Promise<{ installed: boolean; version?: string }> {
  const result = await sshExec(host, 'memeloop --version 2>/dev/null || echo NOT_FOUND');
  if (result.exitCode !== 0 || result.stdout.includes('NOT_FOUND')) {
    return { installed: false };
  }
  return { installed: true, version: result.stdout };
}

/**
 * Install memeloop CLI on a remote server
 */
export async function installRemoteMemeloop(host: SSHHost, onProgress?: (msg: string) => void): Promise<boolean> {
  onProgress?.('Checking Node.js...');
  const nodeCheck = await sshExec(host, 'node --version 2>/dev/null || echo NO_NODE');
  if (nodeCheck.stdout.includes('NO_NODE')) {
    onProgress?.('Installing Node.js...');
    const installNode = await sshExec(host, 'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs', 120000);
    if (installNode.exitCode !== 0) {
      onProgress?.(`Failed to install Node.js: ${installNode.stderr}`);
      return false;
    }
  }

  onProgress?.('Installing memeloop CLI...');
  const result = await sshExec(host, 'npm install -g memeloop-cli 2>&1', 120000);
  if (result.exitCode !== 0) {
    onProgress?.(`Failed to install: ${result.stderr || result.stdout}`);
    return false;
  }

  onProgress?.('Verifying installation...');
  const verify = await checkRemoteMemeloop(host);
  return verify.installed;
}

/**
 * Start memeloop server on a remote server
 */
export async function startRemoteMemeloop(host: SSHHost, port = 5200): Promise<{ success: boolean; url?: string; error?: string }> {
  // Kill any existing memeloop process
  await sshExec(host, 'pkill -f memeloop 2>/dev/null; sleep 1');

  // Start in background with nohup
  const result = await sshExec(host, `nohup memeloop start --port ${port} > /tmp/memeloop.log 2>&1 &`);

  // Wait for it to start
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Check if it's running
  const status = await sshExec(host, 'curl -s http://127.0.0.1:' + port + '/health 2>/dev/null || echo NOT_READY');
  if (status.stdout.includes('NOT_READY')) {
    const logs = await sshExec(host, 'tail -20 /tmp/memeloop.log');
    return { success: false, error: `Server not ready. Logs: ${logs.stdout}` };
  }

  const hostname = host.hostname ?? host.host;
  return { success: true, url: `ws://${hostname}:${port}` };
}
