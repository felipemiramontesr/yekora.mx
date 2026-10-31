import { expect, test, type Page } from '@playwright/test';

/**
 * FC 007 · PWA in a real browser against the static export: the manifest and its icons, the
 * service worker served and installed, and offline navigation (Scenario 3) with the network
 * really cut.
 */

// The other suites block service workers (playwright.local.config.ts); this one is about it.
test.use({ serviceWorkers: 'allow' });

/** Waits until the service worker is active and controls the page. */
async function controlledBy(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => navigator.serviceWorker.controller))) {
    await page.reload();
  }
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller))
    )
    .toBe(true);
}

test('the manifest makes the site installable (T1.2 · M ∧ I)', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest'
  );
  const response = await request.get('/manifest.webmanifest');
  expect(response.status()).toBe(200);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    start_url: '/',
    display: 'standalone',
    theme_color: '#213C41',
    background_color: '#F8F5EE',
  });
  for (const icon of manifest.icons) {
    const file = await request.get(icon.src);
    expect(file.status(), icon.src).toBe(200);
    expect(file.headers()['content-type']).toContain('image/png');
  }
});

test('the service worker is served as JavaScript and takes control (T1.2 · S)', async ({
  page,
  request,
}) => {
  const worker = await request.get('/sw.js');
  expect(worker.status()).toBe(200);
  // Apache maps .js to application/javascript or text/javascript; both are valid for workers.
  expect(worker.headers()['content-type']).toMatch(
    /^(application|text)\/javascript/
  );
  await page.goto('/');
  await controlledBy(page);
});

test('offline: visited pages still open, others show the offline page in their language', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await controlledBy(page);
  // The install step precached both offline pages (checked before cutting the network).
  const cached = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        paths.push(`${name} ${new URL(request.url).pathname}`);
      }
    }
    return paths;
  });
  expect(cached.join('\n')).toMatch(/ \/offline\/$/m);
  expect(cached.join('\n')).toMatch(/ \/en\/offline\/$/m);
  // ...together with every script, style and font they load: offline, a missing chunk makes
  // Next.js reload the page, which then fails.
  for (const offlinePage of ['/offline/', '/en/offline/']) {
    const html = await (await page.request.get(offlinePage)).text();
    for (const [, asset] of html.matchAll(
      /(?:src|href)="(\/_next\/static\/[^"]+)"/g
    )) {
      expect(cached.join('\n'), asset).toContain(` ${asset}`);
    }
  }
  await page.goto('/nosotros/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nosotros');

  await context.setOffline(true);
  const visited = await page.goto('/nosotros/');
  // Served by the worker from its cache, not by the browser's HTTP cache.
  expect(visited?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nosotros');

  await page.goto('/terminos/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Estás fuera de cobertura'
  );
  // Complete offline: the page keeps its URL and its brand styles (petróleo background).
  await expect(page).toHaveURL(/\/terminos\/$/);
  await expect(page.locator('main section').first()).toHaveCSS(
    'background-color',
    'rgb(33, 60, 65)'
  );
  await page.goto('/en/terms/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'You are out of coverage'
  );

  await context.setOffline(false);
  // The retry is a no-action GET form: it must work even if the offline page never hydrated.
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Terms and conditions of use'
  );
});

test('offline pages exist online too and are never indexed', async ({
  page,
}) => {
  for (const path of ['/offline/', '/en/offline/']) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow'
    );
  }
});
