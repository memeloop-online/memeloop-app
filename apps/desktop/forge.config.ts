import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { readJsonSync } from 'fs-extra';
import path from 'path';
import afterPack from './scripts/afterPack';
import { MEMELOOP_EXECUTABLE_NAME, MEMELOOP_PACKAGE_ID, MEMELOOP_PRODUCT_NAME, MEMELOOP_PROTOCOL } from './src/constants/productIdentity';

const packageJson = readJsonSync(path.join(__dirname, 'package.json')) as { description: string };
const supportedLanguages = readJsonSync(path.join(__dirname, 'localization', 'supportedLanguages.json')) as Record<string, string>;

const { description } = packageJson;
// Get list of supported language codes from centralized config
const supportedLanguageCodes = Object.keys(supportedLanguages);

const config: ForgeConfig = {
  rebuildConfig: {
    // Prevent @electron/rebuild from traversing symlinks into sibling projects (e.g. memeloop-cloud)
    // that share the same pnpm store. Only rebuild the native modules actually used by TidGi.
    projectRootPath: __dirname,
    onlyModules: ['bufferutil', 'nsfw', 'registry-js', 'utf-8-validate'],
  },
  packagerConfig: {
    // Keep staging on the same filesystem as `out`. Node 24's recursive
    // cross-device fs.cp can race on TiddlyWiki's very large hard-linked tree;
    // same-device finalization is an atomic rename instead.
    tmpdir: path.resolve(__dirname, '..', '..', '.electron-packager'),
    name: MEMELOOP_PRODUCT_NAME,
    executableName: MEMELOOP_EXECUTABLE_NAME,
    win32metadata: {
      CompanyName: 'MemeLoop',
      FileDescription: MEMELOOP_PRODUCT_NAME,
      InternalName: MEMELOOP_EXECUTABLE_NAME,
      OriginalFilename: `${MEMELOOP_EXECUTABLE_NAME}.exe`,
      ProductName: MEMELOOP_PRODUCT_NAME,
    },
    protocols: [
      {
        name: 'MemeLoop Desktop Launch Protocol',
        schemes: [MEMELOOP_PROTOCOL],
      },
    ],
    icon: 'build-resources/icon.ico',
    asar: {
      // Unpack worker files, utility process files, native modules path, and ALL .node binaries (including better-sqlite3)
      // UtilityProcess files must be unpacked because utilityProcess.fork() reads from the
      // real filesystem, unlike Worker which can read from inside an asar.
      // Vite emits UtilityProcess entries plus their shared chunks under
      // `.vite/build`. Unpack the complete directory: unpacking only the
      // entry file leaves its relative imports trapped inside app.asar.
      unpack: '{**/.vite/build/**/*,**/.webpack/main/*.worker.*,**/.webpack/main/*Worker*,**/.webpack/main/native_modules/path.txt,**/{.**,**}/**/*.node}',
    },
    extraResource: ['localization', 'template/wiki', 'build-resources/tidgiMiniWindow@2x.png', 'build-resources/tidgiMiniWindowTemplate@2x.png'],
    // @ts-expect-error - mac config is valid
    mac: {
      category: 'productivity',
      target: 'dmg',
      icon: 'build-resources/icon.icns',
      electronLanguages: supportedLanguageCodes,
    },
    appBundleId: MEMELOOP_PACKAGE_ID,
  },
  hooks: {
    packageAfterPrune: afterPack,
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: (arch: string) => {
        return {
          name: MEMELOOP_EXECUTABLE_NAME,
          exe: `${MEMELOOP_EXECUTABLE_NAME}.exe`,
          setupExe: `Install-MemeLoop-Desktop-Windows-${arch}.exe`,
          setupIcon: 'build-resources/icon-installer.ico',
          description,
          iconUrl: 'https://raw.githubusercontent.com/tiddly-gittly/TidGi-Desktop/master/build-resources/icon%405x.png',
        };
      },
    },
    {
      name: '@electron-forge/maker-msix',
      platforms: ['win32'],
      config: {
        packageAssets: 'build-resources/icon.ico',
        packageName: 'MemeLoop-Desktop.msix',
        sign: false,
        manifestVariables: {
          packageIdentity: MEMELOOP_PACKAGE_ID,
          packageDisplayName: MEMELOOP_PRODUCT_NAME,
          appExecutable: `${MEMELOOP_EXECUTABLE_NAME}.exe`,
          appDisplayName: MEMELOOP_PRODUCT_NAME,
          publisher: 'CN=TiddlyWiki Community',
        },
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
      config: {},
    },
    {
      name: '@electron-forge/maker-deb',
      platforms: ['linux'],
      config: {
        options: {
          maintainer: 'Lin Onetwo <linonetwo012@gmail.com>',
          mimeType: [`x-scheme-handler/${MEMELOOP_PROTOCOL}`],
        },
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      platforms: ['linux'],
      config: {
        options: {
          maintainer: 'Lin Onetwo <linonetwo012@gmail.com>',
          mimeType: [`x-scheme-handler/${MEMELOOP_PROTOCOL}`],
        },
      },
    },
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      build: [
        {
          // `entry` is an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
