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

// FC 008 (OWASP A05): the exact policy of the FC, on pages and on the 404 alike. FC 055 T2.6 adds the two
// reverse-geocoding origins to connect-src. FC 029 T0.1 and
// T2.2d: img-src admits the API origin, where product images are served by digest.
test('every answer carries the Content-Security-Policy of FC 008 and FC 029', async ({
  request,
}) => {
  const policy =
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://apiv1.yekora.mx; font-src 'self'; connect-src 'self' https://apiv1.yekora.mx https://api-bdc.io https://nominatim.openstreetmap.org; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
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
      'camera=(), microphone=(), geolocation=(self)'
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

// FC 028 T2.6c: a sub-path of the account area (an order, the panel) answers the area's own page,
// in both languages, so a link to an order works on a fresh load and on reload.
test('every sub-path of the account area answers its own page', async ({
  request,
}) => {
  for (const [path, title] of [
    ['/cuenta/', 'Mi cuenta'],
    ['/en/account/', 'My account'],
    ['/cuenta/YEK-2026-AB12CD34/', 'Mi cuenta'],
    ['/cuenta/datos/', 'Mi cuenta'],
    ['/cuenta/metodos-pago/', 'Mi cuenta'],
    ['/cuenta/administracion/', 'Mi cuenta'],
    ['/cuenta/usuarios/', 'Mi cuenta'],
    ['/cuenta/devoluciones/', 'Mi cuenta'],
    ['/cuenta/envios/', 'Mi cuenta'],
    ['/cuenta/catalogo/', 'Mi cuenta'],
    ['/cuenta/catalogo/publicar/', 'Mi cuenta'],
    ['/cuenta/panel/', 'Mi cuenta'],
    ['/en/account/devoluciones', 'My account'],
    ['/en/account/panel/YEK-2026-AB12CD34/', 'My account'],
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(title);
  }
});

// FC 074 (K-77, OWASP A01/A05): an address of the account area the page does not open is a real
// 404 with the exported 404 page, never the page of the area with 200 and never a redirect. The
// retired «administradores» console is one of them, in both languages, and an extra segment after
// a known one is another.
test('an unknown or retired address of the account area is a real 404 with no redirect (T2.1, T2.2)', async ({
  request,
}) => {
  for (const path of [
    '/cuenta/administradores/',
    '/en/account/administradores/',
    '/cuenta/no-existe/',
    '/en/account/no-existe/',
    '/cuenta/datos/x/',
    '/cuenta/panel/no-es-un-folio/',
    '/cuenta/catalogo/otra/',
    '/cuenta/yek-2026-ab12cd34/',
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
    expect(response.headers().location, path).toBeUndefined();
    const body = await response.text();
    expect(body, path).toContain('Ruta no encontrada');
    expect(body, path).not.toMatch(/administrador/i);
  }
});

// FC 074 T2.3: the 404 of the account area carries the same hardening as a page that answers 200.
test('the 404 of the account area carries the same security headers as a page (T2.3)', async ({
  request,
}) => {
  const page = (await request.get('/cuenta/', { maxRedirects: 0 })).headers();
  const missing = (
    await request.get('/cuenta/administradores/', { maxRedirects: 0 })
  ).headers();
  for (const name of [
    'content-security-policy',
    'strict-transport-security',
    'x-content-type-options',
    'referrer-policy',
    'permissions-policy',
  ]) {
    expect(missing[name], name).toBeDefined();
    expect(missing[name], name).toBe(page[name]);
  }
});
