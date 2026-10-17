import { expect, test } from '@playwright/test';

// public/.htaccess as Hostinger's Apache applies it (FC 003). Runs only against the CI httpd
// container (E2E_APACHE): the local static server does not read .htaccess, see
// playwright.local.config.ts.

test('old /es-MX/ links redirect permanently to the root routes', async ({
  request,
}) => {
  const home = await request.get('/es-MX/', { maxRedirects: 0 });
  expect(home.status()).toBe(301);
  expect(home.headers().location).toMatch(/\/$/);
  const about = await request.get('/es-MX/nosotros/', { maxRedirects: 0 });
  expect(about.status()).toBe(301);
  expect(about.headers().location).toMatch(/\/nosotros\/$/);
});

test('an unknown path answers 404 with the exported 404 page', async ({
  request,
}) => {
  const response = await request.get('/no-existe/', { maxRedirects: 0 });
  expect(response.status()).toBe(404);
  expect(await response.text()).toContain('Ruta no encontrada');
});

test('folders without an index are never listed', async ({ request }) => {
  const response = await request.get('/brand/', { maxRedirects: 0 });
  expect(response.status()).toBe(403);
});
