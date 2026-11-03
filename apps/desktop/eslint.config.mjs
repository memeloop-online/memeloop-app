import tidgiConfig from 'eslint-config-tidgi';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default [
  ...tidgiConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['./*.js', './*.mjs', './*.*.js', './*.*.ts', './*.*.mjs'],
        },
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
    },
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    rules: {
      // Vite resolves these query imports and returns worker factories. ESLint's
      // filesystem resolver must not treat the query string as part of the path;
      // scripts/verifyViteQueryImports.mjs separately verifies every backing file.
      'import-x/no-unresolved': [
        'error',
        { caseSensitive: true, ignore: ['\\$:/', '\\?(?:nodeWorker|utilityProcess)$'] },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx', '*.env.d.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      'unicorn/prevent-abbreviations': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
