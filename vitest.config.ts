import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  // Same `@/*` alias as tsconfig.json paths.
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: {
    // Server Components run in node; Client Component tests opt into
    // jsdom per file with `// @vitest-environment jsdom`.
    environment: 'node',
    include: [
      'app/**/*.{test,spec}.{ts,tsx}',
      'components/**/*.{test,spec}.{ts,tsx}',
      'lib/**/*.{test,spec}.{ts,tsx}',
      'apps/api/src/**/*.{test,spec}.ts',
      // CI gate rules (scripts/lib) are tested too, but stay out of product coverage below.
      'scripts/**/*.{test,spec}.ts',
    ],
    // JUnit feeds the per-shard test report and the certification dashboard in CI.
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results.xml' },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'app/**/*.{ts,tsx}',
        'components/**/*.{ts,tsx}',
        'lib/**/*.{ts,tsx}',
        'apps/api/src/**/*.ts',
        // FC 010 (YekoraALE): backup encryption is held to product coverage, unlike the gate rules.
        'scripts/lib/backupCrypto.ts',
        // FC 010: the certification logic is the trust anchor of the dashboard; same bar.
        'scripts/lib/certification.ts',
        // FC 015 (K-31): the parity gate decides whether production matches local; same bar.
        'scripts/lib/dbParity.ts',
      ],
      exclude: [
        'app/**/*.{test,spec}.{ts,tsx}',
        'components/**/*.{test,spec}.{ts,tsx}',
        'lib/**/*.{test,spec}.{ts,tsx}',
        'apps/api/src/**/*.{test,spec}.ts',
        // Process wiring only (node dist/index.js on Hostinger); its logic is start() in index.ts.
        'apps/api/src/server.ts',
        // Vitest 4 matches these globs anywhere in the path, so `lib/**` above also catches
        // scripts/lib: keep the gate rules out, except the three held to product coverage.
        'scripts/lib/!(backupCrypto|certification|dbParity).ts',
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
