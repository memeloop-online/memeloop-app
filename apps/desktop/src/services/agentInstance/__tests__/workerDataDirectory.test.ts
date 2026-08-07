import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureMemeLoopWorkerDataDirectory } from '../workerDataDirectory';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const temporaryRoot of temporaryRoots.splice(0)) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

describe('ensureMemeLoopWorkerDataDirectory', () => {
  it('creates a nested directory under a brand-new user data root', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memeloop-worker-data-'));
    temporaryRoots.push(temporaryRoot);
    const dataDirectory = path.join(temporaryRoot, 'missing', 'parents', 'memeloop');

    await ensureMemeLoopWorkerDataDirectory(dataDirectory);

    expect(fs.statSync(dataDirectory).isDirectory()).toBe(true);
  });

  it('is idempotent across repeated and concurrent initialization', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memeloop-worker-data-'));
    temporaryRoots.push(temporaryRoot);
    const dataDirectory = path.join(temporaryRoot, 'memeloop');

    await Promise.all([
      ensureMemeLoopWorkerDataDirectory(dataDirectory),
      ensureMemeLoopWorkerDataDirectory(dataDirectory),
      ensureMemeLoopWorkerDataDirectory(dataDirectory),
    ]);
    await ensureMemeLoopWorkerDataDirectory(dataDirectory);

    expect(fs.statSync(dataDirectory).isDirectory()).toBe(true);
  });

  it('fails closed with the target path when directory creation fails', async () => {
    const failure = new Error('permission denied');
    const mkdir = vi.fn().mockRejectedValue(failure);

    await expect(ensureMemeLoopWorkerDataDirectory('/blocked/memeloop', mkdir)).rejects.toMatchObject({
      message: 'Failed to create MemeLoop worker data directory: /blocked/memeloop',
      cause: failure,
    });
  });
});
