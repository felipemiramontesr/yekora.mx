import { expect, test, type Page } from '@playwright/test';

/**
 * FC 026 T1.3 · Real stack: site → real API (Fastify) → real MariaDB 11.8.9, with nothing
 * emulated. The database holds the E2E catalog, stock, FIX and shipping tables
 * (scripts/seedE2eStack.ts); the site was built from that API. The browser asks
 * https://apiv1.yekora.mx as in production (the CSP allows only that host) and each request
 * is forwarded, unchanged, to the API on :3001, whose answer goes back as is.
 *
 * Payments are out of reach on purpose: CI holds no processor keys, so a checkout ends in the
 * API's own SERVICE_UNAVAILABLE (FC 012, a processor that is not configured).
 */

const LOCAL_API = process.env.E2E_API_URL ?? 'http://127.0.0.1:3001';

test.beforeEach(async ({ page, context, baseURL }) => {
  await page.route('https://apiv1.yekora.mx/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: `${LOCAL_API}${url.pathname}${url.search}`,
    });
    await route.fulfill({ response });
  });
  await context.addCookies([
    { name: 'yekora_cookie_consent', value: '1', url: baseURL ?? '' },
  ]);
});

const panel = (page: Page) => page.getByRole('dialog');
const summary = (page: Page) =>
  page.locator('main').getByRole('region', { name: /Resumen|Summary/ });

/** Opens a page with these lines in the pack (and, optionally, a delivery state). */
async function withPack(
  page: Page,
  path: string,
  lines: { sku: string; quantity: number }[],
  state?: string
) {
  await page.addInitScript(
    ({ stored, chosen }) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('yekora_cart_v1', stored);
        if (chosen) localStorage.setItem('yekora_shipping_state_v1', chosen);
        sessionStorage.setItem('seeded', '1');
      }
    },
    { stored: JSON.stringify(lines), chosen: state }
  );
  await page.goto(path);
}

test('catalog_bilingual_with_fix: the catalog and the USD reference come from MariaDB', async ({
  page,
}) => {
  await page.goto('/catalogo/');
  for (const name of [
    'Arnés alpino (prueba E2E)',
    'Mochila ligera 28 L (prueba E2E)',
    'Tenis de trail (prueba E2E)',
  ]) {
    await expect(page.locator('main')).toContainText(name);
  }
  await page.goto('/en/catalog/e2e-arnes-alpino/');
  await expect(page.locator('main')).toContainText('Alpine harness (E2E test)');
  await page.getByRole('button', { name: 'Add to pack' }).click();
  await expect(panel(page)).toContainText('$4,850.00 MXN');
  // The FIX stored in exchange_rates (18.5000): 485 000 / 18.5 = 26 216 cents.
  await expect(panel(page)).toContainText('≈ $262.16 USD');
});

test('cart_quote_vat_and_stock_warnings: VAT and stock are the server’s', async ({
  page,
}) => {
  await page.goto('/catalogo/e2e-arnes-alpino/');
  await page.getByRole('button', { name: 'Agregar a la mochila' }).click();
  // 485 000 with VAT: base round(485 000 × 100 / 116) = 418 103, VAT 66 897.
  await expect(panel(page)).toContainText('$4,181.03 MXN');
  await expect(panel(page)).toContainText('$668.97 MXN');
  await expect(panel(page)).toContainText('$4,850.00 MXN');

  await page.goto('/catalogo/e2e-tenis-trail/');
  await expect(page.getByRole('button', { name: 'Agotado' })).toBeDisabled();

  // MariaDB holds 2 backpacks: the third one is refused by the real quote.
  await withPack(page, '/carrito/', [{ sku: 'E2E-0002', quantity: 3 }]);
  await expect(page.locator('main')).toContainText('Solo quedan 2 piezas.');
});

test('shipping_quote_by_state_and_free_threshold: rates read from shipping_rules', async ({
  page,
}) => {
  await withPack(page, '/carrito/', [{ sku: 'E2E-0001', quantity: 1 }]);
  const box = summary(page);
  await box.getByLabel('Estado de entrega').selectOption('ZAC');
  await expect(box.locator('[data-shipping]')).toHaveText('$150.00 MXN');
  await expect(box).toContainText('$5,000.00 MXN');

  // 3 harnesses = $14 550 with VAT, above the $10 000 threshold: shipping is free.
  await page
    .locator('main')
    .getByLabel(/Cantidad/)
    .first()
    .fill('3');
  await expect(box.locator('[data-shipping]')).toHaveText('Gratis');

  await box.getByLabel('Estado de entrega').selectOption('JAL');
  await expect(box.locator('[data-shipping]')).toHaveText(
    'Por el momento no enviamos a Jalisco.'
  );
});

test('checkout_validation_and_503_without_processor: validated, then refused by the API', async ({
  page,
}) => {
  await withPack(page, '/checkout/', [{ sku: 'E2E-0001', quantity: 1 }], 'ZAC');
  const pay = page.getByRole('button', { name: 'Ir a pagar $5,000.00 MXN' });
  await expect(pay).toBeEnabled();

  // A state without shipping blocks paying; a served one brings the total back.
  await page.getByLabel('Estado').selectOption('JAL');
  await expect(page.getByRole('button', { name: /Ir a pagar/ })).toBeDisabled();
  await page.getByLabel('Estado').selectOption('ZAC');
  await expect(pay).toBeEnabled();

  // Nothing filled: the form stops before any request.
  await pay.click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Revisa los campos marcados.' })
  ).toBeVisible();

  const form = page.locator('main form');
  await form.getByLabel('Nombre completo').fill('Ana Flores');
  await form.getByLabel('Correo electrónico').fill('ana@example.com');
  await form.getByLabel('Teléfono').fill('4929421780');
  await form.getByLabel('Calle').fill('Av. Barones');
  await form.getByLabel('Número exterior').fill('209');
  await form.getByLabel('Colonia').fill('Las Américas');
  await form.getByLabel('Municipio o alcaldía').fill('Guadalupe');
  await form.getByLabel('Código postal').fill('98612');
  await form.getByRole('radio', { name: /Tarjeta/ }).check();
  await form.getByRole('checkbox').check();

  const answer = page.waitForResponse((r) => r.url().includes('/v1/checkout'));
  await pay.click();
  expect((await answer).status()).toBe(503);
  await expect(page.locator('main')).toContainText(
    'Los pagos no están disponibles en este momento.'
  );
});
