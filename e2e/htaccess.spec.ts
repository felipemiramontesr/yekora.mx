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

// FC 007: the service worker and manifest bypass HTTP caching; the manifest has its MIME type.
test('the service worker and manifest are never cached by HTTP', async ({
  request,
}) => {
  for (const path of ['/sw.js', '/manifest.webmanifest']) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe(
      'no-cache, no-store, must-revalidate'
    );
  }
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.headers()['content-type']).toContain(
    'application/manifest+json'
  );
});

// FC 008 (OWASP A05): the exact policy of the FC, on pages and on the 404 alike.
test('every answer carries the Content-Security-Policy of FC 008', async ({
  request,
}) => {
  const policy =
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://apiv1.yekora.mx; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
  for (const path of ['/', '/catalogo/', '/en/catalog/', '/no-existe/']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.headers()['content-security-policy']).toBe(policy);
  }
});

// FC 010 (OWASP A02/A05): transport and browser hardening, on pages, the cart and the 404 alike.
test('every answer carries the hardening headers of FC 010', async ({
  request,
}) => {
  for (const path of ['/', '/catalogo/', '/en/cart/', '/no-existe/']) {
    const headers = (await request.get(path, { maxRedirects: 0 })).headers();
    expect(headers['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains'
    );
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toBe(
      'camera=(), microphone=(), geolocation=()'
    );
  }
});

// FC 008: an empty catalog's placeholder page is deleted after the build, so its path is a
// real 404, never a 404 body served with 200.
test('the empty-catalog placeholder path is a real 404', async ({
  request,
}) => {
  for (const path of ['/catalogo/__none__/', '/en/catalog/__none__/']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(404);
  }
});

test('folders without an index are never listed', async ({ request }) => {
  const response = await request.get('/brand/', { maxRedirects: 0 });
  expect(response.status()).toBe(403);
});
