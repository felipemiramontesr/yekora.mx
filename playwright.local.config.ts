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
  // realStack.spec.ts needs the real API and MariaDB: it runs with playwright.stack.config.ts.
  testIgnore: process.env.E2E_APACHE
    ? ['**/smoke.spec.ts', '**/realStack.spec.ts']
    : ['**/smoke.spec.ts', '**/htaccess.spec.ts', '**/realStack.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // FC 026: GitHub's ubuntu-24.04 runner has 4 cores; one worker per core.
  workers: 4,
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
    // FC 026: in WebKit the site's service worker fetches the API itself, past page.route, so an
    // emulated API would be skipped and production reached. Only pwa.spec.ts lets it run.
    serviceWorkers: 'block',
  },
  webServer: process.env.E2E_APACHE
    ? undefined
    : {
        command: 'bun run build && bun scripts/serveStatic.ts 3100',
        // FC 008: the catalog suite builds from the fixture (deploy.yml sets the same in CI).
        env: { CATALOG_FIXTURE: 'e2e/fixtures/catalog.json' },
        url: 'http://localhost:3100',
        reuseExistingServer: false,
        timeout: 180_000,
      },
  // FC 026: desktop Chrome, iPhone (WebKit, Safari's engine) and Android (Chrome on a phone).
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['iPhone 14'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
});
