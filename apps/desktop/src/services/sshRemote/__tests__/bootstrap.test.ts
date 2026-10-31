import { bootstrapRemoteCli, MEMELOOP_CLI_VERSION } from 'memeloop-cli';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapRemote, MEMELOOP_REMOTE_BOOTSTRAP_VERSION } from '../index';

vi.mock('memeloop-cli', async importOriginal => {
  const actual = await importOriginal<typeof import('memeloop-cli')>();
  return {
    ...actual,
    bootstrapRemoteCli: vi.fn(async (options: { version: string; dryRun?: boolean }) => ({
      ok: true as const,
      version: options.version,
      nodeVersion: '24.4.0',
      executable: '/home/operator/.local/bin/memeloop',
      changed: options.dryRun !== true,
      dryRun: options.dryRun === true,
    })),
  };
});

interface CliManifest {
  name: string;
  version: string;
}

function installedCliManifest(): CliManifest {
  return JSON.parse(readFileSync(
    path.join(process.cwd(), 'node_modules', 'memeloop-cli', 'package.json'),
    'utf8',
  )) as CliManifest;
}

describe('Desktop SSH bootstrap boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the installed CLI manifest version as the bootstrap version', () => {
    const manifest = installedCliManifest();
    expect(manifest.name).toBe('memeloop-cli');
    expect(MEMELOOP_REMOTE_BOOTSTRAP_VERSION).toBe(manifest.version);
    expect(MEMELOOP_CLI_VERSION).toBe(manifest.version);
  });

  it('probes through the exact CLI bootstrap without installing', async () => {
    await bootstrapRemote(
      { host: 'worker', hostname: 'worker.example', user: 'operator', port: 2222 },
      { dryRun: true, acceptNewHostKey: false },
    );

    expect(bootstrapRemoteCli).toHaveBeenCalledWith({
      target: 'operator@worker',
      version: MEMELOOP_REMOTE_BOOTSTRAP_VERSION,
      port: 2222,
      identityFile: undefined,
      hostKeyPolicy: 'strict',
      dryRun: true,
    });
  });

  it('uses the same exact version for installation and explicit first-use TOFU', async () => {
    const result = await bootstrapRemote(
      { host: 'worker.example', identityFile: '/keys/worker' },
      { dryRun: false, acceptNewHostKey: true },
    );

    expect(result).toMatchObject({ version: MEMELOOP_REMOTE_BOOTSTRAP_VERSION, changed: true });
    expect(bootstrapRemoteCli).toHaveBeenCalledWith(expect.objectContaining({
      version: MEMELOOP_REMOTE_BOOTSTRAP_VERSION,
      hostKeyPolicy: 'accept-new',
      identityFile: '/keys/worker',
      dryRun: false,
    }));
  });

  it('rejects hostile targets before invoking the SSH bootstrap', async () => {
    await expect(bootstrapRemote(
      { host: 'worker; touch /tmp/pwned' },
      { dryRun: true, acceptNewHostKey: false },
    )).rejects.toThrow('concrete alias');
    expect(bootstrapRemoteCli).not.toHaveBeenCalled();
  });
});
