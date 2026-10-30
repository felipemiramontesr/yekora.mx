import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// FC 025: the Backend (API) job runs the API's unit tests, with no database, and holds apps/api
// to 100 % coverage on its own. The real-SQL suite belongs to the Database job.
const DB_SUITE = 'apps/api/src/db.integration.test.ts';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['apps/api/src/**/*.{test,spec}.ts'],
    exclude: [...configDefaults.exclude, DB_SUITE],
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results.xml' },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['apps/api/src/**/*.ts'],
      exclude: [
        'apps/api/src/**/*.{test,spec}.ts',
        // Process wiring only (node dist/index.js on Hostinger); its logic is start() in index.ts.
        'apps/api/src/server.ts',
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
