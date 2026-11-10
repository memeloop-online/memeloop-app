import fs from 'fs-extra';
import path from 'path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vite';
import { analyzer } from 'vite-bundle-analyzer';
import { utilityProcessPlugin } from 'vite-plugin-electron-utility-process';
import { viteEtcd3ProtoPlugin } from './scripts/viteEtcd3ProtoPlugin';
import { memeloopCliCreateRequirePlugin } from './scripts/viteMemeloopCliCreateRequirePlugin';
import { viteMemeLoopSourceAliases } from './scripts/viteMemeLoopSourceAliases';

// Dynamically read TypeORM's optional peer dependencies to avoid hardcoding
const typeormPackageJson = fs.readJsonSync(path.resolve(__dirname, 'node_modules/typeorm/package.json')) as Record<string, unknown>;
const typeormOptionalDepNames = Object.keys(typeormPackageJson.peerDependenciesMeta || {}).filter(
  (dep) => dep !== 'better-sqlite3',
);

// Convert to RegExp to match both package name and sub-paths
const typeormOptionalDepsRegex = typeormOptionalDepNames.map(
  (dep) => new RegExp(`^${dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/.*)?$`),
);

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
  plugins: [
    // memeloop-cli's ESM distribution bundles typescript-language-server,
    // whose loader calls createRequire(import.meta.url). This plugin anchors
    // that one exact source occurrence to the CommonJS main bundle filename.
    memeloopCliCreateRequirePlugin(__dirname),
    viteEtcd3ProtoPlugin(__dirname),
    ...(process.env.ANALYZE === 'true'
      ? [analyzer({ analyzerMode: 'static', openAnalyzer: false, fileName: 'bundle-analyzer-main' })]
      : []),
    // The agent runtime is isolated in an Electron UtilityProcess for
    // process-level crash isolation.
    utilityProcessPlugin(),
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2021',
      },
    }),
  ],
  resolve: {
    alias: [
      ...viteMemeLoopSourceAliases(__dirname),
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: '@services', replacement: path.resolve(__dirname, './src/services') },
      { find: 'i18next-fs-backend', replacement: path.resolve(__dirname, './node_modules/i18next-fs-backend/cjs/index.js') },
      { find: 'i18next-electron-fs-backend', replacement: path.resolve(__dirname, './node_modules/i18next-electron-fs-backend/cjs/index.js') },
    ],
  },
  build: {
    commonjsOptions: {
      ignoreDynamicRequires: true,
    },
    rollupOptions: {
      external: [
        // Electron is a runtime builtin in main and UtilityProcess chunks.
        // Never bundle the npm launcher package (it contains host __dirname).
        'electron',
        'esbuild',
        '@modelcontextprotocol/sdk',
        /^@modelcontextprotocol\/sdk\//,
        // default-gateway v7 / electron-unhandled v5 are pure ESM, used via dynamic import().
        // External so the dynamic import() runs at Node.js runtime. electron-unhandled
        // has top-level await, which cannot be emitted in this CommonJS main bundle;
        // afterPack copies its exact production dependency closure instead.
        'default-gateway',
        'electron-unhandled',
        // rotating-file-stream@3 is pure ESM ("type":"module") but has a CJS dist.
        // External it so Node.js native require() uses its "exports.require" CJS entry.
        'rotating-file-stream',
        ...typeormOptionalDepsRegex,
        'expo-sqlite',
        // Optional native accelerators used by ws. afterPack copies them when
        // installed and ws otherwise falls back to its portable implementation.
        'bufferutil',
        'utf-8-validate',
        // Optional OS-keyring native bindings are selected at runtime. Keeping
        // the platform package external prevents Rolldown from parsing `.node`
        // binaries; memeloop-cli already fails closed to its 0600 file store
        // when a platform binding is unavailable.
        /^@napi-rs\/keyring-/,
      ],
    },
  },
});
