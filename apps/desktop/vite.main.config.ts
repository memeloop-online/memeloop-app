import fs from 'fs-extra';
import path from 'path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vite';
import { analyzer } from 'vite-bundle-analyzer';
import { utilityProcessPlugin } from 'vite-plugin-electron-utility-process';
import { memeLoopNodeWorkerPlugin } from './scripts/viteNodeWorkerPlugin';

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
    ...(process.env.ANALYZE === 'true'
      ? [analyzer({ analyzerMode: 'static', openAnalyzer: false, fileName: 'bundle-analyzer-main' })]
      : []),
    // MemeLoop's agent runtime still uses a Node worker. Git and Wiki use
    // Electron UtilityProcess below for process-level crash isolation.
    memeLoopNodeWorkerPlugin(),
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
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@services': path.resolve(__dirname, './src/services'),
      // Bundle linked MemeLoop sources into the desktop main/agent-worker
      // chunks, so development and packaging do not depend on stale dist output.
      'memeloop/device-network': path.resolve(__dirname, '../../../memeloop/packages/memeloop/src/device-network-entry.ts'),
      'memeloop/llm-providers': path.resolve(__dirname, '../../../memeloop/packages/memeloop/src/llm-providers.ts'),
      memeloop: path.resolve(__dirname, '../../../memeloop/packages/memeloop/src'),
      'memeloop-cli': path.resolve(__dirname, '../../../memeloop/packages/memeloop-cli/dist'),
      '@memeloop/protocol': path.resolve(__dirname, '../../../memeloop/packages/memeloop-protocol/src'),
      'i18next-fs-backend': path.resolve(__dirname, './node_modules/i18next-fs-backend/cjs/index.js'),
      'i18next-electron-fs-backend': path.resolve(__dirname, './node_modules/i18next-electron-fs-backend/cjs/index.js'),
    },
  },
  build: {
    commonjsOptions: {
      ignoreDynamicRequires: true,
    },
    rollupOptions: {
      external: [
        'sqlite-vec',
        'registry-js',
        'dugite',
        'tiddlywiki',
        'zx',
        'esbuild',
        '@modelcontextprotocol/sdk',
        /^@modelcontextprotocol\/sdk\//,
        // default-gateway v7 / electron-unhandled v5 are pure ESM, used via dynamic import().
        // External so the dynamic import() runs at Node.js runtime.
        'default-gateway',
        'electron-unhandled',
        // rotating-file-stream@3 is pure ESM ("type":"module") but has a CJS dist.
        // External it so Node.js native require() uses its "exports.require" CJS entry.
        'rotating-file-stream',
        ...typeormOptionalDepsRegex,
        'expo-sqlite',
        // Preserve package-relative native addon resolution used by MemeLoop's
        // Noise/libp2p stack. afterPack copies these packages outside asar.
        'bufferutil',
        'utf-8-validate',
        'sodium-universal',
        /^sodium-universal\/.*$/,
        'sodium-native',
        /^sodium-native\/.*$/,
        'require-addon',
        /^require-addon\/.*$/,
      ],
    },
  },
});
