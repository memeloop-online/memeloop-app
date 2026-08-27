import { bootstrapRemoteCli, MEMELOOP_CLI_VERSION } from 'memeloop-cli';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapRemote } from '../index';

vi.mock('memeloop-cli', async importOriginal => {
  const actual = await importOriginal<typeof import('memeloop-cli')>();
  return {
    ...actual,
    bootstrapRemoteCli: vi.fn(async (options: { version: string; dryRun: boolean }) => ({
      ok: true as const,
      version: options.version,
      nodeVersion: '24.4.0',
      executable: '/home/operator/.local/bin/memeloop',
      changed: !options.dryRun,
      dryRun: options.dryRun,
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

  it('pins bootstrap to the exact installed memeloop-cli manifest version', () => {
    const manifest = installedCliManifest();
    expect(manifest.name).toBe('memeloop-cli');
    expect(MEMELOOP_CLI_VERSION).toBe(manifest.version);
  });

  it('probes through the pinned CLI bootstrap without installing', async () => {
    await bootstrapRemote(
      { host: 'worker', hostname: 'worker.example', user: 'operator', port: 2222 },
      { dryRun: true, acceptNewHostKey: false },
    );

    expect(bootstrapRemoteCli).toHaveBeenCalledWith({
      target: 'operator@worker',
      version: MEMELOOP_CLI_VERSION,
      port: 2222,
      identityFile: undefined,
      hostKeyPolicy: 'strict',
      dryRun: true,
    });
  });

  it('uses the same exact version for installation and explicit first-use TOFU', async () => {
    const cliVersion = installedCliManifest().version;
    const result = await bootstrapRemote(
      { host: 'worker.example', identityFile: '/keys/worker' },
      { dryRun: false, acceptNewHostKey: true },
    );

    expect(result).toMatchObject({ version: cliVersion, changed: true });
    expect(bootstrapRemoteCli).toHaveBeenCalledWith(expect.objectContaining({
      version: cliVersion,
      hostKeyPolicy: 'accept-new',
      identityFile: '/keys/worker',
      dryRun: false,
    }));
  });
});
