import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TIDDLYWIKI_EDITION_PATHS_EXCLUDED_FROM_PACKAGE } from '../../../scripts/afterPack';

const staleNoisePackages = [
  'sodium-universal',
  'sodium-native',
  'require-addon',
  'which-runtime',
  'bare-addon-resolve',
  'bare-module-resolve',
  'bare-semver',
];

describe('packaged runtime dependency closure', () => {
  it('does not copy or externalize dependencies removed by Noise 17', () => {
    const afterPackSource = readFileSync(path.resolve(process.cwd(), 'scripts/afterPack.ts'), 'utf8');
    const mainViteSource = readFileSync(path.resolve(process.cwd(), 'vite.main.config.ts'), 'utf8');

    for (const packageName of staleNoisePackages) {
      expect(afterPackSource).not.toContain(`'${packageName}'`);
      expect(mainViteSource).not.toContain(`'${packageName}'`);
    }
  });

  it('installs every declared Noise 17 runtime dependency beside the package', () => {
    const noisePackageDirectory = realpathSync(path.resolve(process.cwd(), 'node_modules/@chainsafe/libp2p-noise'));
    const noiseManifestPath = path.join(noisePackageDirectory, 'package.json');
    const noiseManifest = JSON.parse(readFileSync(noiseManifestPath, 'utf8')) as { dependencies?: Record<string, string> };
    const noiseDependencyDirectory = path.resolve(noisePackageDirectory, '..', '..');

    expect(noiseManifest.dependencies).toBeDefined();
    for (const packageName of Object.keys(noiseManifest.dependencies ?? {})) {
      expect(() => realpathSync(path.join(noiseDependencyDirectory, packageName))).not.toThrow();
    }
  });

  it('excludes only the non-runtime TiddlyWiki survey edition with overlong paths', () => {
    expect(TIDDLYWIKI_EDITION_PATHS_EXCLUDED_FROM_PACKAGE).toEqual([
      ['editions', 'tiddlywiki-surveys'],
    ]);
  });
});
