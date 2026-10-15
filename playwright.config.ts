import { defineConfig, devices } from '@playwright/test';

/**
 * Yekora E2E — deployed-site config. Runs only smoke.spec.ts against YEKORA_BASE_URL.
 * There is no deployed URL yet (Hostinger slot disabled), so this config has nothing to run
 * and is never used by CI. Local and CI runs use playwright.local.config.ts.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/smoke.spec.ts'],
  retries: 0,
  workers: 1,
  reporter: 'html',
  timeout: 45_000,
  use: {
    baseURL: process.env.YEKORA_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
