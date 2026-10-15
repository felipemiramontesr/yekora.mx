import { defineConfig, devices } from '@playwright/test';

/**
 * Yekora E2E — local config, the only one CI runs.
 * Target: the Next.js dev server on http://localhost:3000.
 * smoke.spec.ts is reserved for checks against a deployed URL and is always excluded here;
 * the CI anti-PROD guard asserts both rules before Playwright starts.
 */
export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/smoke.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'html',
  timeout: 45_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 720 },
  },
  // CI starts the dev server in its own step; locally Playwright starts it or reuses it.
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
