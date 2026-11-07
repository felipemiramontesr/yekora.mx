import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// FC 025/026: the Frontend (Next.js) job runs the site only: never apps/api (Backend job) nor
// scripts/ (CI Tooling job). Coverage stays enforced over the whole product by vitest.config.ts
// in the SonarQube job.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: {
    environment: 'node',
    // Same flag as vitest.config.ts: next/link keeps the trailing `/` of the static export.
    env: { __NEXT_TRAILING_SLASH: 'true' },
    include: [
      'app/**/*.{test,spec}.{ts,tsx}',
      'components/**/*.{test,spec}.{ts,tsx}',
      'lib/**/*.{test,spec}.{ts,tsx}',
    ],
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results.xml' },
  },
});
