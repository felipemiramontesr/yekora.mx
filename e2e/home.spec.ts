import { expect, test } from '@playwright/test';

// The static export as Hostinger serves it (FC 003): Spanish at the root, English under /en/
// with translated slugs, no locale redirect and no language cookie.

test('the root is the Spanish home page, whatever the browser language', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle('YĒKORA | Tienda Outdoor');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-MX');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Equipo adecuado'
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://yekora.mx/'
  );
});

test('the English home page lives under /en/ with its hreflang pair', async ({
  page,
}) => {
  await page.goto('/en/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'The right gear'
  );
  await expect(page.locator('link[hreflang="es-MX"]')).toHaveAttribute(
    'href',
    'https://yekora.mx/'
  );
  await expect(page.locator('link[hreflang="x-default"]')).toHaveAttribute(
    'href',
    'https://yekora.mx/'
  );
});

test('disciplines are anchors inside the current language', async ({
  page,
}) => {
  await page.goto('/');
  const nav = page
    .getByRole('navigation', { name: 'Navegación principal' })
    .first();
  await nav.getByRole('link', { name: 'Escalada' }).click();
  await expect(page).toHaveURL(/\/#escalada$/);
  await expect(page.locator('#escalada')).toBeVisible();
  // The catalog does not exist yet: a label, not a link.
  await expect(nav.getByText('Próximamente')).toBeVisible();
  await expect(nav.getByRole('link', { name: /Catálogo/ })).toHaveCount(0);
});

test('switching language opens the same page in the other language, with no cookie', async ({
  page,
  context,
}) => {
  await page.goto('/nosotros/');
  const switcher = page.getByRole('navigation', { name: 'Idioma' }).first();
  await switcher.getByRole('link', { name: 'English' }).click();
  await expect(page).toHaveURL(/\/en\/about\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('About us');

  await page
    .getByRole('navigation', { name: 'Language' })
    .first()
    .getByRole('link', { name: 'Español' })
    .click();
  await expect(page).toHaveURL(/\/nosotros\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-MX');
  expect(await context.cookies()).toEqual([]);
});

test('the cookie notice describes its single technical cookie and stays dismissed', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const banner = page.getByRole('region', { name: 'Aviso de cookies' });
  await expect(banner).toContainText('solo usa una cookie técnica');
  await banner.getByRole('button', { name: 'Entendido' }).click();
  await expect(banner).toBeHidden();
  const cookies = await context.cookies();
  expect(cookies.map((cookie) => cookie.name)).toEqual([
    'yekora_cookie_consent',
  ]);
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Aviso de cookies' })
  ).toBeHidden();
});

test('legal pages are reachable from the footer in both languages', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('contentinfo')
    .getByRole('link', { name: 'Aviso de privacidad' })
    .click();
  await expect(page).toHaveURL(/\/privacidad\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Aviso de privacidad'
  );

  await page.goto('/en/');
  await page
    .getByRole('contentinfo')
    .getByRole('link', { name: 'Cookie policy' })
    .click();
  await expect(page).toHaveURL(/\/en\/cookies\/$/);
  await expect(page.getByRole('table')).toContainText('yekora_cookie_consent');
  await expect(page.getByRole('table')).not.toContainText('yekora_locale');

  await page.goto('/terminos/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Términos y condiciones'
  );
  await page.goto('/en/terms/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Terms and conditions of use'
  );
});

test('the mobile menu opens without client JavaScript', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 360, height: 800 },
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByText('Menú').click();
  const menu = page.locator('details nav');
  await expect(menu.getByRole('link', { name: 'Cañonismo' })).toBeVisible();
  await context.close();
});

test('an unknown path is a 404', async ({ page }) => {
  const response = await page.goto('/no-existe/');
  expect(response?.status()).toBe(404);
});
