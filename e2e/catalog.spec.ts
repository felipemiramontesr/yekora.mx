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

/**
 * FC 047: the navigation that lives in the account menu of the header (the language, and the
 * sections of the account), a <details> that is opened first. The disciplines are not here: they
 * are the strip under the bar, always in view.
 */
async function headerNav(page: Page, name: string | RegExp) {
  const menu = page.getByRole('banner').locator('details');
  const closed = await menu.evaluate((d) => !(d as HTMLDetailsElement).open);
  // Opened only when closed: a second click on the summary would fold it again.
  if (closed) await menu.locator('summary').click();
  return page
    .getByRole('navigation', { name })
    .filter({ visible: true })
    .first();
}
// The catalog's selects, by their exact name (the footer also has a «Disciplinas» nav).
const filter = (page: Page, name: string) =>
  page.getByRole('combobox', { name, exact: true });

test('the Spanish catalog lists every product in pesos only', async ({
  page,
}) => {
  await page.goto('/catalogo/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Catálogo');
  await expect(page.locator('main').getByRole('status')).toHaveText(
    '3 productos'
  );
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
  await expect(page.locator('main').getByRole('status')).toHaveText(
    '1 producto'
  );

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
  // The canonical link search engines read is the one of the served page: exactly one.
  await page.goto('/catalogo/e2e-arnes-alpino/');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://yekora.mx/catalogo/e2e-arnes-alpino/'
  );
  await page.goto('/catalogo/');
  // FC 043: a card is a next/link. Clicked while React still hydrates (WebKit, run 42521281000),
  // the client navigation leaves the catalog's canonical link behind in the open page only; the
  // served HTML above is unaffected. The selects turn enabled at hydration (FC 035 T1.1).
  await expect(filter(page, 'Disciplina')).toBeEnabled();
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

  await (
    await headerNav(page, 'Idioma')
  )
    .getByRole('link', { name: 'EN, English' })
    .click();
  await expect(page).toHaveURL(/\/en\/catalog\/e2e-arnes-alpino\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Alpine harness (E2E test)'
  );
  await expect(page.locator('main')).toContainText('≈ $262.16 USD');

  await page.getByRole('link', { name: 'Back to the catalog' }).click();
  await expect(page).toHaveURL(/\/en\/catalog\/$/);
});

test('the header searches the catalog of each language (FC 047 T1.2)', async ({
  page,
}) => {
  for (const [home, label, path] of [
    ['/', 'Buscar en la tienda', /\/catalogo\/\?q=arn/],
    ['/en/', 'Search the store', /\/en\/catalog\/\?q=arn/],
  ] as const) {
    await page.goto(home);
    const box = page.getByRole('combobox', { name: label });
    await box.fill('arn');
    await box.press('Enter');
    await expect(page).toHaveURL(path);
  }
});

test('the search of the header suggests products and opens the one chosen with the keyboard (FC 047 T1.2, T2.2)', async ({
  page,
}) => {
  await page.goto('/');
  const box = page.getByRole('combobox', { name: 'Buscar en la tienda' });
  // Nothing is fetched until the box takes the focus.
  const asked = page.waitForRequest('**/search-index.json');
  await box.focus();
  await asked;
  await box.fill('arnes');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(box).toHaveAttribute('aria-expanded', 'true');
  await box.press('ArrowDown');
  await expect(page.getByRole('option').first()).toHaveAttribute(
    'aria-selected',
    'true'
  );
  await box.press('Enter');
  await expect(page).toHaveURL(/\/catalogo\/e2e-arnes-alpino\/$/);
});

test('the catalog shows only the results of the search and of the discipline in the address (FC 047 T1.2, T2.1)', async ({
  page,
}) => {
  await page.goto('/catalogo/?q=mochila');
  await expect(
    page.getByRole('status').filter({ hasText: 'Resultados para' })
  ).toContainText('Resultados para «mochila» · 1 producto');
  await page.getByRole('button', { name: 'Quitar la búsqueda' }).click();
  await expect(page).toHaveURL(/\/catalogo\/$/);
  await page.goto('/catalogo/?disciplina=escalada');
  await expect(cards(page)).toHaveCount(1);
  await expect(page.locator('main')).toContainText('Arnés alpino');
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
