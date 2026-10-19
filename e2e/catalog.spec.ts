import { expect, test, type Page } from '@playwright/test';

/**
 * FC 008 F3 · Catalog. The suite builds from e2e/fixtures/catalog.json (CATALOG_FIXTURE): three
 * fictitious products, including the FC's canonical row 485000 MXN cents / FIX 18.5000 →
 * 26216 USD cents. Production never receives them (deploy.yml refuses any e2e- product page).
 */

// Content-Security-Policy violations the browser reports while the page loads and runs.
function cspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      message.text().includes('Content Security Policy')
    ) {
      violations.push(message.text());
    }
  });
  return violations;
}

const cards = (page: Page) => page.locator('main li');
// The catalog's selects, by their exact name (the footer also has a «Disciplinas» nav).
const filter = (page: Page, name: string) =>
  page.getByRole('combobox', { name, exact: true });

test('the Spanish catalog lists every product in pesos only', async ({
  page,
}) => {
  await page.goto('/catalogo/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Catálogo');
  await expect(page.getByRole('status')).toHaveText('3 productos');
  await expect(cards(page)).toHaveCount(3);
  await expect(page.locator('main')).toContainText('$4,850.00 MXN');
  await expect(page.locator('main')).toContainText(
    'Precios en pesos mexicanos (MXN).'
  );
  // Ω: pesos are what Spanish pages show; the USD reference is for English pages.
  await expect(page.locator('main')).not.toContainText('USD');
  await expect(page.locator('main')).toContainText('Agotado');
});

test('the English catalog adds the USD reference with its Banxico FIX', async ({
  page,
}) => {
  await page.goto('/en/catalog/');
  const harness = cards(page).filter({ hasText: 'Alpine harness' });
  await expect(harness).toContainText('$4,850.00 MXN');
  // Canonical row of the FC: Math.round(485000 / 18.5000) = 26216 cents.
  await expect(harness).toContainText('≈ $262.16 USD');
  await expect(page.locator('main')).toContainText(
    "Banxico's FIX exchange rate of October 16, 2026 (18.5000 MXN per USD)"
  );
});

test('filters by discipline and level, sorts by price and recovers from an empty result', async ({
  page,
}) => {
  await page.goto('/catalogo/');
  await filter(page, 'Disciplina').selectOption({ label: 'Escalada' });
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page)).toContainText('Arnés alpino');
  await expect(page.getByRole('status')).toHaveText('1 producto');

  await filter(page, 'Nivel').selectOption({ label: 'Principiante' });
  await expect(page.getByText('Ningún producto coincide')).toBeVisible();
  await page.getByRole('button', { name: 'Quitar filtros' }).click();
  await expect(cards(page)).toHaveCount(3);

  await filter(page, 'Ordenar por').selectOption('price_desc');
  await expect(cards(page).locator('h2')).toHaveText([
    'Arnés alpino (prueba E2E)',
    'Tenis de trail (prueba E2E)',
    'Mochila ligera 28 L (prueba E2E)',
  ]);
  await filter(page, 'Ordenar por').selectOption('price_asc');
  await expect(cards(page).locator('h2').first()).toHaveText(
    'Mochila ligera 28 L (prueba E2E)'
  );
});

test('a card opens its product page, which switches language and leads back', async ({
  page,
}) => {
  await page.goto('/catalogo/');
  await cards(page)
    .filter({ hasText: 'Arnés alpino' })
    .getByRole('link')
    .click();
  await expect(page).toHaveURL(/\/catalogo\/e2e-arnes-alpino\/$/);
  await expect(page).toHaveTitle('Arnés alpino (prueba E2E) | YĒKORA');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Arnés alpino (prueba E2E)'
  );
  await expect(page.locator('main')).toContainText('Escalada');
  await expect(page.locator('main')).toContainText('Avanzado');
  await expect(page.locator('main')).toContainText('Disponible');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://yekora.mx/catalogo/e2e-arnes-alpino/'
  );

  await page
    .getByRole('navigation', { name: 'Idioma' })
    .first()
    .getByRole('link', { name: 'English' })
    .click();
  await expect(page).toHaveURL(/\/en\/catalog\/e2e-arnes-alpino\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Alpine harness (E2E test)'
  );
  await expect(page.locator('main')).toContainText('≈ $262.16 USD');

  await page.getByRole('link', { name: 'Back to the catalog' }).click();
  await expect(page).toHaveURL(/\/en\/catalog\/$/);
});

test('the header links the catalog in both languages', async ({ page }) => {
  for (const [home, name, path] of [
    ['/', 'Catálogo', /\/catalogo\/$/],
    ['/en/', 'Catalog', /\/en\/catalog\/$/],
  ] as const) {
    await page.goto(home);
    await page
      .getByRole('navigation', { name: /Navegación principal|Main navigation/ })
      .first()
      .getByRole('link', { name })
      .click();
    await expect(page).toHaveURL(path);
  }
});

test('an unknown product is a 404', async ({ page }) => {
  const response = await page.goto('/catalogo/no-existe/');
  expect(response?.status()).toBe(404);
});

test('without JavaScript the full catalog still shows', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  await page.goto('/en/catalog/');
  await expect(cards(page)).toHaveCount(3);
  await context.close();
});

test('catalog and product pages run under the CSP without a single violation', async ({
  page,
}) => {
  const violations = cspViolations(page);
  for (const path of [
    '/catalogo/',
    '/en/catalog/',
    '/catalogo/e2e-tenis-trail/',
    '/en/catalog/e2e-mochila-ligera-28l/',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  await page.goto('/catalogo/');
  await filter(page, 'Disciplina').selectOption({ label: 'Senderismo' });
  await expect(cards(page)).toHaveCount(1);
  expect(violations).toEqual([]);
});

test('product pages fit a phone and keep 44 px targets', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of [
    '/catalogo/e2e-arnes-alpino/',
    '/en/catalog/e2e-tenis-trail/',
  ]) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);
    const back = await page
      .getByRole('link', { name: /Volver al catálogo|Back to the catalog/ })
      .boundingBox();
    expect(back?.height).toBeGreaterThanOrEqual(44);
  }
});
