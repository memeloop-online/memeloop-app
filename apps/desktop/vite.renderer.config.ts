import react from '@vitejs/plugin-react';
import { realpathSync } from 'node:fs';
import path from 'path';
import { defineConfig, type PluginOption } from 'vite';
import { analyzer } from 'vite-bundle-analyzer';
import monacoEditorPlugin from 'vite-plugin-monaco-editor';
import { viteMemeLoopSourceAliases } from './scripts/viteMemeLoopSourceAliases';

const desktopDependency = (packageName: string): string => realpathSync(path.resolve(__dirname, 'node_modules', packageName));

// The desktop package is also consumable from the repository workspace. pnpm's
// hoisted linker can expose the same Vite build through two physical module
// paths, whose private plugin types TypeScript treats as nominally different.
const localPlugin = (plugin: unknown): PluginOption => plugin as PluginOption;

export default defineConfig({
  plugins: [
    ...(process.env.ANALYZE === 'true'
      ? [localPlugin(analyzer({ analyzerMode: 'static', openAnalyzer: false, fileName: 'bundle-analyzer-renderer' }))]
      : []),
    localPlugin(react()),
    localPlugin(monacoEditorPlugin({})),
  ],
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      '@mui/material',
      '@mui/icons-material',
      '@mui/system',
      '@emotion/react',
      '@emotion/styled',
      'ai',
      'ajv',
      'material-ui-cron',
      '@radix-ui/react-primitive',
      '@radix-ui/react-slot',
    ],
    alias: [
      ...viteMemeLoopSourceAliases(__dirname),
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: '@services', replacement: path.resolve(__dirname, './src/services') },
      { find: 'react', replacement: desktopDependency('react') },
      { find: 'react-dom', replacement: desktopDependency('react-dom') },
      { find: 'simplebar-react', replacement: desktopDependency('simplebar-react') },
      { find: '@rjsf/core', replacement: desktopDependency('@rjsf/core') },
      { find: '@rjsf/mui', replacement: desktopDependency('@rjsf/mui') },
      { find: '@rjsf/utils', replacement: desktopDependency('@rjsf/utils') },
      { find: '@rjsf/validator-ajv8', replacement: desktopDependency('@rjsf/validator-ajv8') },
      { find: '@assistant-ui/react', replacement: desktopDependency('@assistant-ui/react') },
      { find: /^ai$/u, replacement: desktopDependency('ai') },
      { find: /^ajv$/u, replacement: desktopDependency('ajv') },
      { find: /^material-ui-cron$/u, replacement: desktopDependency('material-ui-cron') },
      { find: /^@radix-ui\/react-primitive$/u, replacement: desktopDependency('@radix-ui/react-primitive') },
      { find: /^@radix-ui\/react-slot$/u, replacement: desktopDependency('@radix-ui/react-slot') },
    ],
  },
  optimizeDeps: {
    include: ['monaco-editor'],
    exclude: ['memeloop', 'memeloop-cli', '@memeloop/react-ui'],
  },
  build: {
    // Output to .vite/renderer for consistency
    outDir: '.vite/renderer',
    // Specify the HTML entry point
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
      output: {
        manualChunks(id) {
          return id.includes('/monaco-editor/') ? 'monaco-editor' : undefined;
        },
      },
    },
    commonjsOptions: {
      include: [/monaco-editor/, /node_modules/],
    },
  },
  server: {
    port: 3012, // Match the port from webpack config
  },
});
