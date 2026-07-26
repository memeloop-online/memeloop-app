import react from '@vitejs/plugin-react';
import { realpathSync } from 'node:fs';
import path from 'path';
import { defineConfig, type PluginOption } from 'vite';
import { analyzer } from 'vite-bundle-analyzer';
import monacoEditorPlugin from 'vite-plugin-monaco-editor';

const desktopDependency = (packageName: string): string => realpathSync(path.resolve(__dirname, 'node_modules', packageName));
const memeloopReactUiDependency = (packageName: string): string =>
  realpathSync(
    path.resolve(
      __dirname,
      '../../../memeloop/packages/memeloop-react-ui/node_modules',
      packageName,
    ),
  );

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
    dedupe: ['react', 'react-dom', '@mui/material', '@mui/icons-material', '@mui/system', '@emotion/react', '@emotion/styled'],
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@services': path.resolve(__dirname, './src/services'),
      '@memeloop/react-ui': path.resolve(
        __dirname,
        '../../../memeloop/packages/memeloop-react-ui/dist',
      ),
      react: desktopDependency('react'),
      'react-dom': desktopDependency('react-dom'),
      'simplebar-react': desktopDependency('simplebar-react'),
      '@rjsf/core': desktopDependency('@rjsf/core'),
      '@rjsf/mui': desktopDependency('@rjsf/mui'),
      '@rjsf/utils': desktopDependency('@rjsf/utils'),
      '@rjsf/validator-ajv8': desktopDependency('@rjsf/validator-ajv8'),
      '@assistant-ui/react': memeloopReactUiDependency('@assistant-ui/react'),
    },
  },
  optimizeDeps: {
    include: ['monaco-editor'],
    exclude: ['memeloop', 'memeloop-cli', '@memeloop/protocol', '@memeloop/react-ui'],
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
