import { defineConfig, devices } from '@playwright/test';

/**
 * Yekora E2E · real stack (FC 026 T1.3): only e2e/realStack.spec.ts, against the static site on
 * :3100 built from the real API on :3001, which reads a migrated and seeded MariaDB. CI starts
 * all three before Playwright (deploy.yml, job e2e-stack-validation), so there is no webServer
 * here. The browser still asks https://apiv1.yekora.mx, as the CSP allows; the spec forwards
 * those requests to the local API.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: ['realStack.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 4,
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { open: 'never', outputFolder: 'playwright-stack-report' }],
      ]
    : 'list',
  timeout: 45_000,
  use: {
    baseURL: 'http://localhost:3100',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 720 },
    // The forwarding in realStack.spec.ts is a page.route: no service worker may fetch past it.
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
