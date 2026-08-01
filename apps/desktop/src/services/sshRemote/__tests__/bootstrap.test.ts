import { bootstrapRemoteCli, MEMELOOP_CLI_VERSION } from 'memeloop-cli';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapRemote } from '../index';

vi.mock('memeloop-cli', () => ({
  MEMELOOP_CLI_VERSION: '0.2.0',
  bootstrapRemoteCli: vi.fn(async (options: { version: string; dryRun: boolean }) => ({
    ok: true as const,
    version: options.version,
    nodeVersion: '24.4.0',
    executable: '/home/operator/.local/bin/memeloop',
    changed: !options.dryRun,
    dryRun: options.dryRun,
  })),
}));

describe('Desktop SSH bootstrap boundary', () => {
  beforeEach(() => vi.clearAllMocks());

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
    const result = await bootstrapRemote(
      { host: 'worker.example', identityFile: '/keys/worker' },
      { dryRun: false, acceptNewHostKey: true },
    );

    expect(result).toMatchObject({ version: '0.2.0', changed: true });
    expect(bootstrapRemoteCli).toHaveBeenCalledWith(expect.objectContaining({
      version: '0.2.0',
      hostKeyPolicy: 'accept-new',
      identityFile: '/keys/worker',
      dryRun: false,
    }));
  });
});
