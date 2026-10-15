import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['app/**/*.test.{ts,tsx}'],
    // JUnit feeds the per-shard test report and the certification dashboard in CI.
    reporters: ['default', 'junit'],
    outputFile: { junit: 'test-results.xml' },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['app/**/*.{ts,tsx}'],
      exclude: ['app/**/*.test.{ts,tsx}'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
