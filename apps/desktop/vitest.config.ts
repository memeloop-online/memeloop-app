import path from 'path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // pnpm can expose this Vite plugin and Vitest's Vite type through different
  // physical paths. They are the same runtime version, but private types make
  // the two declarations nominally incompatible.
  plugins: [swc.vite({
    jsc: {
      transform: {
        react: {
          runtime: 'automatic',
        },
      },
    },
  }) as never],

  test: {
    // Test environment
    environment: 'jsdom',

    // Vitest 4 still accepts this runtime option, although it is absent from
    // the public InlineConfig type.
    // @ts-expect-error Vitest runtime compatibility option
    environmentMatchGlobs: [
      ['features/**', 'node'],
    ],

    // Setup files
    setupFiles: ['./src/__tests__/setup-vitest.ts'],

    // Test file patterns
    include: [
      'src/**/__tests__/**/*.(test|spec).(ts|tsx|js)',
      'src/**/*.(test|spec).(ts|tsx|js)',
      'features/**/*.(test|spec).(ts|tsx|js)',
    ],

    // Global test settings - this makes vi, expect, etc. available globally
    globals: true,

    // Coverage settings
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'src/**/*.{ts,tsx}',
      ],
      exclude: [
        'src/**/*.d.ts',
        'src/__tests__/**/*',
        'src/main.ts',
        'src/preload/**/*',
      ],
    },

    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['default', 'hanging-process'],
  },

  pool: 'forks',
  poolOptions: {
    forks: {
      maxForks: 6,
      minForks: 2,
    },
    isolate: true,
  },

  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: '@services', replacement: path.resolve(__dirname, './src/services') },
      { find: '@memeloop/react-ui', replacement: path.resolve(__dirname, '../../../memeloop/packages/memeloop-react-ui/dist') },
      { find: /^memeloop\/device-network$/, replacement: path.resolve(__dirname, '../../../memeloop/packages/memeloop/src/device-network-entry.ts') },
      { find: /^memeloop\/llm-providers$/, replacement: path.resolve(__dirname, '../../../memeloop/packages/memeloop/src/llm-providers.ts') },
      { find: 'memeloop', replacement: path.resolve(__dirname, '../../../memeloop/packages/memeloop/src') },
      { find: 'memeloop-node', replacement: path.resolve(__dirname, '../../../memeloop/packages/memeloop-node/dist') },
      { find: '@memeloop/protocol', replacement: path.resolve(__dirname, '../../../memeloop/packages/memeloop-protocol/src') },
      { find: /agentInstance\/memeloopWorkerFactory(\.ts)?$/, replacement: path.resolve(__dirname, './src/__tests__/__stubs__/memeloopWorkerFactoryStub.ts') },
      { find: /\?nodeWorker$/, replacement: path.resolve(__dirname, './src/__tests__/__stubs__/memeloopWorkerFactoryStub.ts') },
      // Force React-family packages from linked @memeloop/react-ui to resolve from memeloop-desktop.
      { find: /^react$/, replacement: path.resolve(__dirname, './node_modules/react') },
      { find: /^react\/(.*)/, replacement: path.resolve(__dirname, './node_modules/react/$1') },
      { find: /^react-dom$/, replacement: path.resolve(__dirname, './node_modules/react-dom') },
      { find: /^react-dom\/(.*)/, replacement: path.resolve(__dirname, './node_modules/react-dom/$1') },
      { find: /^@emotion\/react$/, replacement: path.resolve(__dirname, './node_modules/@emotion/react') },
      { find: /^@emotion\/react\/(.*)/, replacement: path.resolve(__dirname, './node_modules/@emotion/react/$1') },
      { find: /^@emotion\/styled$/, replacement: path.resolve(__dirname, './node_modules/@emotion/styled') },
      { find: /^@emotion\/styled\/(.*)/, replacement: path.resolve(__dirname, './node_modules/@emotion/styled/$1') },
      { find: /^@mui\/material$/, replacement: path.resolve(__dirname, './node_modules/@mui/material') },
      { find: /^@mui\/material\/(.*)/, replacement: path.resolve(__dirname, './node_modules/@mui/material/$1') },
      { find: /^@mui\/icons-material$/, replacement: path.resolve(__dirname, './node_modules/@mui/icons-material') },
      { find: /^@mui\/icons-material\/(.*)/, replacement: path.resolve(__dirname, './node_modules/@mui/icons-material/$1') },
      // Stub optional MCP SDK so tests don't fail on import-resolution when SDK is not installed
      { find: /^@modelcontextprotocol\/sdk\/.*$/, replacement: path.resolve(__dirname, './src/__tests__/__stubs__/mcpSdkStub.ts') },
      // Vite 7 stricter ESM resolution: beautiful-react-hooks imports "lodash.debounce" not "lodash/debounce"
      { find: 'lodash.debounce', replacement: path.resolve(__dirname, './node_modules/lodash/debounce.js') },
    ],
  },

  // Handle CSS and static assets
  assetsInclude: ['**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.svg'],
});
