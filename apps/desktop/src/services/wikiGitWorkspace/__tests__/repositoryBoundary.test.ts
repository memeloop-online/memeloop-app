import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hasOwnGitRepository } from '../index';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { force: true, recursive: true })));
});

describe('hasOwnGitRepository', () => {
  it('does not treat a parent checkout as the wiki repository', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'memeloop-wiki-git-boundary-'));
    temporaryRoots.push(parent);
    await mkdir(path.join(parent, '.git'));
    const wiki = path.join(parent, 'nested', 'wiki');
    await mkdir(wiki, { recursive: true });

    await expect(hasOwnGitRepository(wiki)).resolves.toBe(false);

    await writeFile(path.join(wiki, '.git'), 'gitdir: ../wiki.git\n');
    await expect(hasOwnGitRepository(wiki)).resolves.toBe(true);
  });
});
