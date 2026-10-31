import path from 'path';
import { defineConfig } from 'vite';
import { viteMemeLoopSourceAliases } from './scripts/viteMemeLoopSourceAliases';

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: [
      ...viteMemeLoopSourceAliases(__dirname),
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: '@services', replacement: path.resolve(__dirname, './src/services') },
    ],
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'preload.js',
      },
      external: [
        'electron',
      ],
    },
  },
});
