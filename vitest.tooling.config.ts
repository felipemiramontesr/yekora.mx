import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// FC 026: the CI Tooling job runs the tests of scripts/ (gates, migrator, certification), which
// are neither the site nor the API. Coverage stays enforced by vitest.config.ts in the SonarQube
// job.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['scripts/**/*.{test,spec}.ts'],
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results.xml' },
  },
});
