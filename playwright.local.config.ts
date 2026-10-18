import { defineConfig, devices } from '@playwright/test';

/**
 * Yekora E2E — local config, the only one CI runs.
 * Target: the static export in out/, never the dev server, so the suite sees what Hostinger serves.
 * Locally Playwright builds and serves out/ with scripts/serveStatic.ts; CI serves it with
 * Apache (httpd:2.4 + mod_rewrite) and sets E2E_APACHE, which also runs htaccess.spec.ts
 * (the local server does not read .htaccess).
 * smoke.spec.ts is reserved for checks against a deployed URL and is always excluded here;
 * the CI anti-PROD guard asserts both rules before Playwright starts.
 */
export default defineConfig({
  testDir: './e2e',
  testIgnore: process.env.E2E_APACHE
    ? ['**/smoke.spec.ts']
    : ['**/smoke.spec.ts', '**/htaccess.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : 4,
  // In CI the github reporter turns every failure into a public annotation on the run, so the
  // exact error is readable without downloading logs; the HTML report stays as an artifact.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
  timeout: 45_000,
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 720 },
  },
  webServer: process.env.E2E_APACHE
    ? undefined
    : {
        command: 'bun run build && bun scripts/serveStatic.ts 3100',
        url: 'http://localhost:3100',
        reuseExistingServer: false,
        timeout: 180_000,
      },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
