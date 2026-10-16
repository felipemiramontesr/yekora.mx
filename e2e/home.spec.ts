import { expect, test } from '@playwright/test';

test.describe('a Spanish-speaking browser', () => {
  test.use({ locale: 'es-MX' });

  test('the root sends visitors to the Spanish home page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/es-MX$/);
    await expect(page).toHaveTitle('YĒKORA | Tienda Outdoor');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-MX');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Equipo adecuado'
    );
  });
});

test.describe('an English-speaking browser', () => {
  test.use({ locale: 'en-US' });

  test('the root sends visitors to the English home page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'The right gear'
    );
  });
});

test('disciplines are anchors inside the current language', async ({
  page,
}) => {
  await page.goto('/es-MX');
  const nav = page
    .getByRole('navigation', { name: 'Navegación principal' })
    .first();
  await nav.getByRole('link', { name: 'Escalada' }).click();
  await expect(page).toHaveURL(/\/es-MX#escalada$/);
  await expect(page.locator('#escalada')).toBeVisible();
  // The catalog does not exist yet: a label, not a link.
  await expect(nav.getByText('Próximamente')).toBeVisible();
  await expect(nav.getByRole('link', { name: /Catálogo/ })).toHaveCount(0);
});

test('switching to English keeps the page and remembers the choice', async ({
  page,
  context,
}) => {
  await page.goto('/es-MX/nosotros');
  await page
    .getByRole('navigation', { name: 'Idioma' })
    .first()
    .getByRole('link', { name: 'English' })
    .click();
  await expect(page).toHaveURL(/\/en\/nosotros$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('About us');
  const cookies = await context.cookies();
  expect(cookies.find((cookie) => cookie.name === 'yekora_locale')?.value).toBe(
    'en'
  );

  await page.goto('/');
  await expect(page).toHaveURL(/\/en$/);
});

test('the cookie notice only describes technical cookies and stays dismissed', async ({
  page,
}) => {
  await page.goto('/es-MX');
  const banner = page.getByRole('region', { name: 'Aviso de cookies' });
  await expect(banner).toContainText('solo usa cookies técnicas');
  await banner.getByRole('button', { name: 'Entendido' }).click();
  await expect(banner).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Aviso de cookies' })
  ).toBeHidden();
});

test('legal pages are reachable from the footer in both languages', async ({
  page,
}) => {
  await page.goto('/es-MX');
  const footer = page.getByRole('contentinfo');
  await footer.getByRole('link', { name: 'Aviso de privacidad' }).click();
  await expect(page).toHaveURL(/\/es-MX\/privacidad$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Aviso de privacidad'
  );
  await page.goto('/en/cookies');
  await expect(page.getByRole('table')).toContainText('yekora_cookie_consent');
  await page.goto('/en/terminos');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Terms and conditions of use'
  );
});

test('the mobile menu opens without client JavaScript', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/es-MX');
  await page.getByText('Menú').click();
  const menu = page.locator('details nav');
  await expect(menu.getByRole('link', { name: 'Cañonismo' })).toBeVisible();
});

test('an unsupported language is a 404', async ({ page }) => {
  const response = await page.goto('/fr');
  expect(response?.status()).toBe(404);
});
