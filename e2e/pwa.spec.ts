import { expect, test, type Page } from '@playwright/test';

/**
 * FC 007 · PWA in a real browser against the static export: the manifest and its icons, the
 * service worker served and installed, and offline navigation (Scenario 3) with the network
 * really cut.
 */

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
  await page.goto('/nosotros/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nosotros');

  await context.setOffline(true);
  await page.goto('/nosotros/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Nosotros');

  await page.goto('/terminos/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Estás fuera de cobertura'
  );
  await page.goto('/en/terms/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'You are out of coverage'
  );

  await context.setOffline(false);
  // The retry is a plain link: it must work even if the offline page never hydrated.
  await page.getByRole('link', { name: 'Try again' }).click();
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
