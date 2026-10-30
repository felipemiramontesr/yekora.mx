import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// FC 025: the Database (SQL) job runs only the real-SQL suite, against the MariaDB service that
// the job starts and migrates first. One file, in order: its tests share that database.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['apps/api/src/db.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results.xml' },
  },
});
