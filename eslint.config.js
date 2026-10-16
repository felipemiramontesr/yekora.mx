import tsParser from '@typescript-eslint/parser';
import sonarjs from 'eslint-plugin-sonarjs';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      'dist/**',
      'build/**',
      '.next/**',
      // Static export output (next build with output: 'export').
      'out/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'protocols/**',
      // Protocol L brokers are local-only (.gitignore); the CI scripts in scripts/*.ts are linted.
      'scripts/*.mjs',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: { 'no-unused-vars': 'warn' },
  },
  // Same rule set SonarQube Cloud applies, so issues surface before the push.
  sonarjs.configs.recommended,
];
