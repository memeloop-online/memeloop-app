import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUNDLED_ETCD3_PROTO_DIRECTORY,
  PACKAGED_BETTER_SQLITE_RUNTIME_PATHS,
  PACKAGED_ELECTRON_UNHANDLED_PACKAGE,
  REQUIRED_ETCD3_PROTO_FILES,
  TIDDLYWIKI_EDITION_PATHS_EXCLUDED_FROM_PACKAGE,
} from '../../../scripts/afterPack';

const staleNoisePackages = [
  'sodium-universal',
  'sodium-native',
  'require-addon',
  'which-runtime',
  'bare-addon-resolve',
  'bare-module-resolve',
  'bare-semver',
];

const findPackageRoot = (entryPath: string, expectedPackageName: string): string => {
  let currentDirectory = path.dirname(realpathSync(entryPath));

  while (true) {
    const manifestPath = path.join(currentDirectory, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string };
      if (manifest.name === expectedPackageName) return currentDirectory;
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) throw new Error(`Could not find package root for ${expectedPackageName}`);
    currentDirectory = parentDirectory;
  }
};

const resolveDependencyFromOwner = (ownerRoot: string, dependencyName: string): string => {
  let currentDirectory = ownerRoot;

  while (true) {
    const dependencyDirectory = path.join(currentDirectory, 'node_modules', ...dependencyName.split('/'));
    if (existsSync(dependencyDirectory)) return realpathSync(dependencyDirectory);

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) throw new Error(`Could not resolve ${dependencyName} from ${ownerRoot}`);
    currentDirectory = parentDirectory;
  }
};

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
    const libp2pEntryPath = fileURLToPath(import.meta.resolve('@memeloop/libp2p'));
    const libp2pPackageDirectory = findPackageRoot(libp2pEntryPath, '@memeloop/libp2p');
    const noisePackageDirectory = resolveDependencyFromOwner(libp2pPackageDirectory, '@chainsafe/libp2p-noise');
    const noiseManifestPath = path.join(noisePackageDirectory, 'package.json');
    const noiseManifest = JSON.parse(readFileSync(noiseManifestPath, 'utf8')) as { dependencies?: Record<string, string> };

    expect(noiseManifest.dependencies).toBeDefined();
    for (const packageName of Object.keys(noiseManifest.dependencies ?? {})) {
      expect(() => resolveDependencyFromOwner(noisePackageDirectory, packageName)).not.toThrow();
    }
  });

  it('allows the Windows installer lifecycle and explicitly denies protobufjs', () => {
    const workspacePolicy = readFileSync(path.resolve(process.cwd(), 'pnpm-workspace.yaml'), 'utf8');
    const wininstallerPatch = readFileSync(path.resolve(process.cwd(), 'patches/electron-winstaller@5.4.0.patch'), 'utf8');

    expect(workspacePolicy).toMatch(/onlyBuiltDependencies:\n(?: {2}- .+\n)* {2}- electron-winstaller\n/);
    expect(workspacePolicy).toMatch(/allowBuilds:\n(?: {2}.+\n)* {2}electron-winstaller: true\n/);
    expect(workspacePolicy).toMatch(/allowBuilds:\n(?: {2}.+\n)* {2}protobufjs: false\n/);
    expect(workspacePolicy).toContain('electron-winstaller@5.4.0: patches/electron-winstaller@5.4.0.patch');
    expect(wininstallerPatch).toContain('+const arch = os.arch();');
  });

  it('excludes only the non-runtime TiddlyWiki survey edition with overlong paths', () => {
    expect(TIDDLYWIKI_EDITION_PATHS_EXCLUDED_FROM_PACKAGE).toEqual([
      ['editions', 'tiddlywiki-surveys'],
    ]);
  });

  it('declares the complete etcd3 proto closure beside the bundled main process', () => {
    const etcd3PackageDirectory = findPackageRoot(fileURLToPath(import.meta.resolve('etcd3')), 'etcd3');
    const protoDirectory = path.join(etcd3PackageDirectory, 'proto');
    const installedProtoFiles = readdirSync(protoDirectory)
      .filter(fileName => fileName.endsWith('.proto'))
      .sort();

    expect(BUNDLED_ETCD3_PROTO_DIRECTORY).toEqual(['.vite', 'proto']);
    expect(installedProtoFiles).toEqual([...REQUIRED_ETCD3_PROTO_FILES].sort());
  });

  it('declares the better-sqlite3 JavaScript entry closure beside its native binding', () => {
    const betterSqliteDirectory = findPackageRoot(fileURLToPath(import.meta.resolve('better-sqlite3')), 'better-sqlite3');
    const manifest = JSON.parse(readFileSync(path.join(betterSqliteDirectory, 'package.json'), 'utf8')) as { main?: string };
    expect(manifest.main).toBe('lib/index.js');
    if (!manifest.main) throw new Error('better-sqlite3 manifest has no main entry');
    expect(PACKAGED_BETTER_SQLITE_RUNTIME_PATHS).toEqual([
      ['better-sqlite3', 'package.json'],
      ['better-sqlite3', 'lib'],
    ]);
    expect(existsSync(path.join(betterSqliteDirectory, manifest.main))).toBe(true);
  });

  it('pins electron-unhandled to its exact production dependency graph', () => {
    const electronUnhandledDirectory = findPackageRoot(
      fileURLToPath(import.meta.resolve(PACKAGED_ELECTRON_UNHANDLED_PACKAGE)),
      PACKAGED_ELECTRON_UNHANDLED_PACKAGE,
    );
    const manifest = JSON.parse(readFileSync(path.join(electronUnhandledDirectory, 'package.json'), 'utf8')) as {
      type?: string;
      dependencies?: Record<string, string>;
    };
    expect(manifest.type).toBe('module');
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      'clean-stack',
      'electron-is-dev',
      'ensure-error',
      'lodash.debounce',
      'serialize-error',
    ]);
    const serializeErrorDirectory = resolveDependencyFromOwner(electronUnhandledDirectory, 'serialize-error');
    const serializeErrorManifest = JSON.parse(readFileSync(path.join(serializeErrorDirectory, 'package.json'), 'utf8')) as { version?: string };
    expect(serializeErrorManifest.version).toBe('11.0.3');
  });

  it('does not retain the removed moment runtime closure', () => {
    const fileStreamRotatorDirectory = findPackageRoot(
      fileURLToPath(import.meta.resolve('file-stream-rotator')),
      'file-stream-rotator',
    );
    const manifest = JSON.parse(readFileSync(path.join(fileStreamRotatorDirectory, 'package.json'), 'utf8')) as {
      version?: string;
      dependencies?: Record<string, string>;
    };
    const afterPackSource = readFileSync(path.resolve(process.cwd(), 'scripts/afterPack.ts'), 'utf8');
    const mainViteSource = readFileSync(path.resolve(process.cwd(), 'vite.main.config.ts'), 'utf8');

    expect(manifest.version).toBe('1.0.0');
    expect(manifest.dependencies).not.toHaveProperty('moment');
    expect(afterPackSource).not.toContain('PACKAGED_MOMENT_PACKAGE');
    expect(mainViteSource).not.toMatch(/\n\s*['"]moment['"],/);
  });
});
