/**
 * Copy necessary dependencies after packaging
 * Based on https://ganeshrvel.medium.com/electron-builder-afterpack-configuration-5c2c986be665
 * Adapted for electron forge https://github.com/electron-userland/electron-forge/issues/2248
 */
import fs from 'fs-extra';
import path from 'path';

export const TIDDLYWIKI_EDITION_PATHS_EXCLUDED_FROM_PACKAGE = [
  ['editions', 'tiddlywiki-surveys'],
] as const;

/**
 * Running afterPack hook
 * Forge 8 exposes packageAfterPrune as a promise-based Forge hook.
 * The first argument is the resolved Forge configuration.
 * @param buildPath /var/folders/qj/7j0zx32d0l75zmnrl1w3m3b80000gn/T/electron-packager/darwin-x64/TidGi-darwin-x64/Electron.app/Contents/Resources/app
 * @param electronVersion 12.0.6
 * @param platform darwin / win32 (even on win11 x64)
 * @param arch x64
 */
export default async (
  _forgeConfig: unknown,
  buildPath: string,
  _electronVersion: string,
  platform: string,
  arch: string,
): Promise<void> => {
  const cwd = path.resolve(buildPath, '..');
  const appNodeModulesDirectory = path.resolve(buildPath, 'node_modules');
  const projectRoot = path.resolve(__dirname, '..');
  const sourceNodeModulesFolder = path.resolve(projectRoot, 'node_modules');
  const resolvePackageSource = (...packagePathInNodeModules: string[]) => path.resolve(sourceNodeModulesFolder, ...packagePathInNodeModules);

  const getSqliteVecPlatformPackageName = () => {
    const os = platform === 'win32' ? 'windows' : platform;
    return `sqlite-vec-${os}-${arch}`;
  };

  const getBetterSqliteBinaryPaths = (): string[][] => {
    const compiledBinary = ['better-sqlite3', 'build', 'Release', 'better_sqlite3.node'];
    if (fs.existsSync(resolvePackageSource(...compiledBinary))) {
      return [compiledBinary];
    }

    // Some better-sqlite3 v13 distributions expose N-API binaries under
    // prebuilds instead. Supporting both layouts keeps local installs and CI
    // source builds deterministic without guessing which installer ran.
    if (platform === 'linux') {
      // Keep both libc variants so the same Linux package can start on glibc
      // and musl hosts. better-sqlite3 selects the correct N-API binary.
      return [
        ['better-sqlite3', 'prebuilds', `linux-${arch}.node`],
        ['better-sqlite3', 'prebuilds', `linuxmusl-${arch}.node`],
      ];
    }
    return [['better-sqlite3', 'prebuilds', `${platform}-${arch}.node`]];
  };

  console.log(
    'Copy runtime dependencies used by UtilityProcess and the MemeLoop agent worker',
  );

  if (['production', 'test'].includes(process.env.NODE_ENV ?? '')) {
    console.log('Copying runtime dependencies to dist');

    fs.cpSync(
      path.join(sourceNodeModulesFolder, 'zx'),
      path.join(cwd, 'node_modules', 'zx'),
      { dereference: true, recursive: true },
    );

    const packagePathsToCopyDereferenced: string[][] = [
      ...getBetterSqliteBinaryPaths(),
      // Wiki workers load boot/core/plugin files from process.resourcesPath.
      ['tiddlywiki'],
      // `ws` optional native deps (required in our bundled Electron runtime when it tries to resolve them)
      ['bufferutil'],
      ['utf-8-validate'],
      // Pure ESM/CJS packages externalized by vite.main.config.ts.
      ['rotating-file-stream', 'package.json'],
      ['rotating-file-stream', 'dist', 'cjs', 'index.js'],
      ['rotating-file-stream', 'dist', 'cjs', 'package.json'],
      // nsfw native module
      ['nsfw', 'build', 'Release', 'nsfw.node'],
      // Refer to `node_modules\sqlite-vec\index.cjs` for latest file names
      // sqlite-vec: copy main entry files and platform-specific binary
      ['sqlite-vec', 'package.json'],
      ['sqlite-vec', 'index.cjs'],
      [getSqliteVecPlatformPackageName()],
    ];

    // macOS only: copy app-path binary for finding apps
    if (platform === 'darwin') {
      packagePathsToCopyDereferenced.push(['app-path', 'main']);
    }

    console.log('Copying packagePathsToCopyDereferenced');
    const optionalPackages = new Set(['bufferutil', 'utf-8-validate']);
    for (const packagePathInNodeModules of packagePathsToCopyDereferenced) {
      const first = packagePathInNodeModules[0] ?? '';
      const source = resolvePackageSource(...packagePathInNodeModules);

      if (!fs.existsSync(source)) {
        // ws deliberately falls back to its portable JavaScript implementation
        // when these optional native accelerators are not installed.
        if (optionalPackages.has(first)) {
          console.log(`Skipping optional packaged dependency: ${first}`);
          continue;
        }
        throw new Error(
          `Required packaged dependency is missing: ${packagePathInNodeModules.join('/')} (looked in ${sourceNodeModulesFolder})`,
        );
      }

      const destinationMain = path.resolve(
        cwd,
        'node_modules',
        ...packagePathInNodeModules,
      );
      fs.copySync(source, destinationMain, { dereference: true });

      // Survey source material is not used by MemeLoop at runtime and contains
      // filenames whose relative paths exceed the limits of MSIX and NuGet.
      // Keep all actual TiddlyWiki editions and exclude only this archive.
      if (first === 'tiddlywiki') {
        for (const editionPath of TIDDLYWIKI_EDITION_PATHS_EXCLUDED_FROM_PACKAGE) {
          fs.removeSync(path.resolve(destinationMain, ...editionPath));
        }
      }

      // These packages may be required from inside app.asar bundles, so place
      // them both in Resources/node_modules and Resources/app/node_modules.
      if (
        first === 'bufferutil' ||
        first === 'utf-8-validate'
      ) {
        const destinationApp = path.resolve(
          appNodeModulesDirectory,
          ...packagePathInNodeModules,
        );
        fs.copySync(source, destinationApp, { dereference: true });
      }
    }

    console.log('Copy dugite');
    // it has things like `git/bin/libexec/git-core/git-add` link to `git/bin/libexec/git-core/git`, to reduce size, so can't use `dereference: true, recursive: true` here.
    // pnpm exposes the package itself as a symlink. Resolve only that outer
    // link, then preserve dugite's internal links in the copied Git runtime.
    const dugiteSource = fs.realpathSync(path.join(sourceNodeModulesFolder, 'dugite'));
    const dugiteDestination = path.join(cwd, 'node_modules', 'dugite');
    fs.removeSync(dugiteDestination);
    fs.copySync(
      dugiteSource,
      dugiteDestination,
      { dereference: false },
    );
    // The Vite main bundle keeps `require('dugite')` external, so Node must
    // find its lightweight JS entry under app/node_modules. Keep the 155 MB
    // embedded Git distribution only in Resources/node_modules; GitService
    // points dugite to it through LOCAL_GIT_DIRECTORY at runtime.
    fs.copySync(
      path.join(sourceNodeModulesFolder, 'dugite', 'package.json'),
      path.join(appNodeModulesDirectory, 'dugite', 'package.json'),
      { dereference: true },
    );
    fs.copySync(
      path.join(sourceNodeModulesFolder, 'dugite', 'build'),
      path.join(appNodeModulesDirectory, 'dugite', 'build'),
      { dereference: true },
    );

    if (platform === 'win32') {
      console.log('Copy registry-js (Windows only)');
      // registry-js has native binary that is loaded using relative path (../../build/Release/registry.node)
      fs.copySync(
        path.join(sourceNodeModulesFolder, 'registry-js'),
        path.join(cwd, 'node_modules', 'registry-js'),
        { dereference: true },
      );
    }
  }
};
