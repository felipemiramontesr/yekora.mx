import { expect, test, type Page, type Route } from '@playwright/test';
import fixture from './fixtures/catalog.json' with { type: 'json' };

/**
 * FC 009 F3 · Guest cart. Built from e2e/fixtures/catalog.json (fictitious e2e- products).
 * The quote API is intercepted in the browser and answered with the server's own formula
 * (apps/api/src/services/cartQuote.ts), so no test ever reaches production.
 *
 * FC 011 · Shipping: the interceptor also emulates the rate tables (one flat-by-state rule set
 * and free shipping from a threshold) and truth table T1.1 (400 when a line cannot be bought).
 */

const STOCK: Record<string, number> = {
  'E2E-0001': 10, // alpine harness · 485 000 net
  'E2E-0002': 2, // backpack · only 2 left
  'E2E-0003': 0, // trail shoes · out of stock
};
const FIX = fixture.exchangeRate;

/** Rate tables of the interceptor: ZONE_RATE per state, free from $10 000 with VAT. */
const RATES: Record<string, number> = { ZAC: 15000, CMX: 9900 };
const FREE_FROM = 1_000_000;

type Quote = ReturnType<typeof quoteFor>;

/** Adds the shipping line exactly as the API does, or the T1.1 refusal. */
function shipTo(quote: Quote, stateCode: string) {
  if (quote.items.length === 0 || quote.items.some((i) => !i.purchasable)) {
    return {
      status: 400,
      body: {
        type: 'about:blank',
        title: 'Cart cannot be quoted',
        status: 400,
        detail: 'EMPTY_OR_UNAVAILABLE_CART',
      },
    };
  }
  const items = quote.summary.itemsTotalMxnCents;
  const rate = RATES[stateCode];
  const covered = rate !== undefined;
  const free = covered && items >= FREE_FROM;
  const total = covered && !free ? rate : 0;
  const base = Math.round((total * 100) / 116);
  let code = 'UNSERVICEABLE_DESTINATION';
  if (covered) code = free ? 'FREE_SHIPPING' : 'STANDARD_RATE';
  const grand = quote.summary.itemsTotalMxnCents + total;
  return {
    status: 200,
    body: {
      ...quote,
      summary: {
        ...quote.summary,
        shippingCode: code,
        shippingBaseMxnCents: base,
        shippingTaxMxnCents: total - base,
        shippingTotalMxnCents: total,
        serviceable: covered,
        freeShippingRemainingMxnCents: covered
          ? Math.max(FREE_FROM - items, 0)
          : null,
        subtotalMxnCents: quote.summary.itemsBaseMxnCents + base,
        taxMxnCents: quote.summary.itemsTaxMxnCents + total - base,
        totalMxnCents: grand,
        referenceUsdCents:
          grand > 0 ? Math.round(grand / Number(FIX.rate)) : null,
      },
    },
  };
}

function quoteFor(items: { sku: string; quantity: number }[], lang: string) {
  const products =
    lang === 'en' ? fixture.products.en : fixture.products['es-MX'];
  const totals = {
    subtotalMxnCents: 0,
    taxMxnCents: 0,
    totalMxnCents: 0,
    totalItems: 0,
  };
  const warnings: { sku: string; code: string }[] = [];
  const lines = items.map(({ sku, quantity }) => {
    const product = products.find((p) => p.sku === sku);
    if (!product) {
      warnings.push({ sku, code: 'unavailable' });
      return {
        sku,
        slug: null,
        name: null,
        quantity,
        unitPriceMxnCents: null,
        lineTotalMxnCents: null,
        lineBaseMxnCents: null,
        lineTaxMxnCents: null,
        stockStatus: 'unavailable',
        availableQuantity: 0,
        purchasable: false,
      };
    }
    const stock = STOCK[sku];
    const total = product.priceMxnCents * quantity;
    const base = Math.round((total * 100) / 116);
    const purchasable = stock >= quantity;
    if (stock === 0) warnings.push({ sku, code: 'out_of_stock' });
    else if (!purchasable) warnings.push({ sku, code: 'insufficient_stock' });
    if (purchasable) {
      totals.subtotalMxnCents += base;
      totals.taxMxnCents += total - base;
      totals.totalMxnCents += total;
      totals.totalItems += quantity;
    }
    let stockStatus = 'available';
    if (stock === 0) stockStatus = 'out_of_stock';
    else if (stock < 5) stockStatus = 'low_stock';
    return {
      sku,
      slug: product.slug,
      name: product.name,
      quantity,
      unitPriceMxnCents: product.priceMxnCents,
      lineTotalMxnCents: total,
      lineBaseMxnCents: base,
      lineTaxMxnCents: total - base,
      stockStatus,
      availableQuantity: Math.min(stock, 99),
      purchasable,
    };
  });
  return {
    items: lines,
    summary: {
      // FC 011: products only; no destination yet, so no shipping line.
      itemsBaseMxnCents: totals.subtotalMxnCents,
      itemsTaxMxnCents: totals.taxMxnCents,
      itemsTotalMxnCents: totals.totalMxnCents,
      shippingCode: null,
      shippingBaseMxnCents: null,
      shippingTaxMxnCents: null,
      shippingTotalMxnCents: null,
      serviceable: true,
      freeShippingRemainingMxnCents: null,
      ...totals,
      referenceUsdCents:
        totals.totalMxnCents > 0
          ? Math.round(totals.totalMxnCents / Number(FIX.rate))
          : null,
      exchangeRate: FIX,
    },
    warnings,
  };
}

async function mockQuoteApi(page: Page, mode: 'ok' | 'down' = 'ok') {
  await page.route(
    'https://apiv1.yekora.mx/v1/cart/quote**',
    async (route: Route) => {
      if (mode === 'down') return route.abort('connectionrefused');
      const lang =
        new URL(route.request().url()).searchParams.get('lang') ?? 'es-MX';
      const { items, destination } = route.request().postDataJSON() as {
        items: { sku: string; quantity: number }[];
        destination?: { stateCode: string };
      };
      const quote = quoteFor(items, lang);
      const answer = destination
        ? shipTo(quote, destination.stateCode)
        : { status: 200, body: quote };
      return route.fulfill({
        status: answer.status,
        contentType:
          answer.status === 200
            ? 'application/json'
            : 'application/problem+json',
        headers: { 'access-control-allow-origin': 'http://localhost:3100' },
        body: JSON.stringify(answer.body),
      });
    }
  );
}

const cartButton = (page: Page) =>
  page
    .getByRole('banner')
    .getByRole('link', { name: /Abrir tu mochila|Open your pack/ });
const panel = (page: Page) => page.getByRole('dialog');

test.beforeEach(async ({ page }) => {
  await mockQuoteApi(page);
});

test('the cart is visible from launch with 0 and an empty pack (Ω decision)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(cartButton(page)).toHaveAccessibleName(
    'Abrir tu mochila (0 productos)'
  );
  await page.goto('/carrito/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Tu mochila'
  );
  await expect(page.locator('main')).toContainText('Tu mochila está vacía');
  await expect(
    page.locator('main').getByRole('link', { name: 'Ver catálogo' })
  ).toHaveAttribute('href', '/catalogo/');
  await page.goto('/en/cart/');
  await expect(page.locator('main')).toContainText('Your pack is empty');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex, nofollow'
  );
});

test('adds from the product page, opens the panel and totals with VAT included', async ({
  page,
}) => {
  await page.goto('/catalogo/e2e-arnes-alpino/');
  await expect(page.locator('main')).toContainText('IVA incluido');
  await page.getByRole('button', { name: 'Agregar a la mochila' }).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText('Arnés alpino (prueba E2E)');
  // Net 485 000 cents: base round(485 000 × 100 / 116) = 418 103, VAT 66 897.
  await expect(panel(page)).toContainText('$4,181.03 MXN');
  await expect(panel(page)).toContainText('$668.97 MXN');
  await expect(panel(page)).toContainText('$4,850.00 MXN');
  await expect(cartButton(page)).toHaveAccessibleName(
    'Abrir tu mochila (1 producto)'
  );
  await panel(page).getByRole('button', { name: 'Cerrar' }).click();
  await expect(panel(page)).toBeHidden();
});

test('changes quantities, keeps the cart across visits and empties it', async ({
  page,
}) => {
  await page.goto('/catalogo/e2e-arnes-alpino/');
  await page.getByRole('button', { name: 'Agregar a la mochila' }).click();
  await panel(page)
    .getByRole('button', {
      name: 'Agregar una unidad de Arnés alpino (prueba E2E)',
    })
    .click();
  await expect(panel(page)).toContainText('$9,700.00 MXN');
  await page.goto('/carrito/');
  await expect(page.locator('main')).toContainText('$9,700.00 MXN');
  await expect(page.locator('main')).toContainText('2 piezas');
  await page
    .locator('main')
    .getByRole('button', {
      name: 'Quitar Arnés alpino (prueba E2E) de la mochila',
    })
    .click();
  await expect(page.locator('main')).toContainText('Tu mochila está vacía');
  expect(
    await page.evaluate(() => localStorage.getItem('yekora_cart_v1'))
  ).toBeNull();
});

test('stores only SKU and quantity in the browser (T1.4, no personal data)', async ({
  page,
}) => {
  await page.goto('/catalogo/e2e-arnes-alpino/');
  await page.getByRole('button', { name: 'Agregar a la mochila' }).click();
  const stored = await page.evaluate(() =>
    localStorage.getItem('yekora_cart_v1')
  );
  expect(JSON.parse(stored ?? '[]')).toEqual([
    { sku: 'E2E-0001', quantity: 1 },
  ]);
  expect((await page.context().cookies()).map((c) => c.name)).not.toContain(
    'yekora_cart_v1'
  );
});

test('offers to adjust when fewer units are left, and blocks out-of-stock products', async ({
  page,
}) => {
  await page.goto('/catalogo/e2e-tenis-trail/');
  await expect(page.getByRole('button', { name: 'Agotado' })).toBeDisabled();
  await page.goto('/catalogo/e2e-mochila-ligera-28l/');
  const add = page.getByRole('button', { name: 'Agregar a la mochila' });
  await add.click();
  await panel(page).getByRole('button', { name: 'Cerrar' }).click();
  await add.click();
  await panel(page).getByRole('button', { name: 'Cerrar' }).click();
  await add.click();
  await expect(panel(page)).toContainText('Solo quedan 2 piezas.');
  await panel(page).getByRole('button', { name: 'Ajustar a 2' }).click();
  await expect(panel(page)).not.toContainText('Solo quedan');
  await expect(panel(page)).toContainText('$3,700.00 MXN');
});

test('shows the USD reference in English only', async ({ page }) => {
  await page.goto('/en/catalog/e2e-arnes-alpino/');
  await expect(page.locator('main')).toContainText('VAT included');
  await page.getByRole('button', { name: 'Add to pack' }).click();
  await expect(panel(page)).toContainText('$4,850.00 MXN');
  // 485 000 / 18.5000 = 26 216 cents.
  await expect(panel(page)).toContainText('≈ $262.16 USD');
});

test('keeps working when the quote API cannot be reached', async ({ page }) => {
  await page.unroute('https://apiv1.yekora.mx/v1/cart/quote**');
  await mockQuoteApi(page, 'down');
  await page.goto('/catalogo/e2e-arnes-alpino/');
  await page.getByRole('button', { name: 'Agregar a la mochila' }).click();
  // No confirmed quote yet: the line shows its SKU (the browser stores nothing else) and no
  // amount is invented.
  await expect(panel(page)).toContainText('E2E-0001');
  await expect(panel(page)).not.toContainText('MXN');
  await expect(panel(page)).toContainText(
    /No pudimos actualizar los precios|Sin conexión/
  );
});

test('follows the cart across tabs', async ({ context, page }) => {
  await page.goto('/');
  const other = await context.newPage();
  await mockQuoteApi(other);
  await other.goto('/catalogo/e2e-arnes-alpino/');
  await other.getByRole('button', { name: 'Agregar a la mochila' }).click();
  await expect(cartButton(page)).toHaveAccessibleName(
    'Abrir tu mochila (1 producto)'
  );
});

test('the cart link works without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  await page.goto('/');
  await cartButton(page).click();
  await expect(page).toHaveURL(/\/carrito\/$/);
  await context.close();
});

test('the cart panel and page run under the CSP without a violation', async ({
  page,
}) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      message.text().includes('Content Security Policy')
    ) {
      violations.push(message.text());
    }
  });
  await page.goto('/catalogo/e2e-arnes-alpino/');
  await page.getByRole('button', { name: 'Agregar a la mochila' }).click();
  await expect(panel(page)).toContainText('$4,850.00 MXN');
  await page.goto('/carrito/');
  await expect(page.locator('main')).toContainText('$4,850.00 MXN');
  expect(violations).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// FC 011 · Shipping
// ---------------------------------------------------------------------------------------------

/** Opens /carrito/ (or /en/cart/) with these lines already in the pack. */
async function packWith(
  page: Page,
  lines: { sku: string; quantity: number }[],
  path = '/carrito/'
) {
  await page.addInitScript((stored) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('yekora_cart_v1', stored);
      sessionStorage.setItem('seeded', '1');
    }
  }, JSON.stringify(lines));
  await page.goto(path);
}

const summary = (page: Page) =>
  page.locator('main').getByRole('region', { name: /Resumen|Summary/ });

test('prices shipping for the chosen state, keeps only its code and frees it from the threshold', async ({
  page,
}) => {
  await packWith(page, [{ sku: 'E2E-0001', quantity: 1 }]);
  const box = summary(page);
  await expect(box).toContainText(
    'El costo de envío se calcula al ingresar tu dirección de entrega.'
  );
  await expect(
    box.getByLabel('Estado de entrega').locator('option')
  ).toHaveCount(33);

  await box.getByLabel('Estado de entrega').selectOption('ZAC');
  await expect(box.locator('[data-shipping]')).toHaveText('$150.00 MXN');
  await expect(box).toContainText('$4,850.00 MXN'); // products with VAT
  await expect(box).toContainText('$5,000.00 MXN'); // total with shipping
  await expect(box).toContainText(
    'Te faltan $5,150.00 MXN para el envío gratis.'
  );
  expect(
    await page.evaluate(() => localStorage.getItem('yekora_shipping_state_v1'))
  ).toBe('ZAC');

  // The state survives a visit; the postal code is never asked for nor kept.
  await page.reload();
  await expect(box.getByLabel('Estado de entrega')).toHaveValue('ZAC');
  await expect(box.locator('[data-shipping]')).toHaveText('$150.00 MXN');

  // 3 harnesses = $14 550: above the threshold, shipping is free.
  await page
    .locator('main')
    .getByLabel(/Cantidad/)
    .first()
    .fill('3');
  await expect(box.locator('[data-shipping]')).toHaveText('Gratis');
  await expect(box).toContainText('Tu envío es gratis.');
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  expect(keys).toEqual(['yekora_cart_v1', 'yekora_shipping_state_v1']);
});

test('says plainly when a state has no shipping, and in English names it', async ({
  page,
}) => {
  await packWith(page, [{ sku: 'E2E-0001', quantity: 1 }]);
  await summary(page).getByLabel('Estado de entrega').selectOption('JAL');
  await expect(summary(page).locator('[data-shipping]')).toHaveText(
    'Por el momento no enviamos a Jalisco.'
  );
  await page.goto('/en/cart/');
  await summary(page).getByLabel('Delivery state').selectOption('CMX');
  await expect(summary(page).locator('[data-shipping]')).toHaveText(
    '$99.00 MXN'
  );
  await summary(page).getByLabel('Delivery state').selectOption('YUC');
  await expect(summary(page).locator('[data-shipping]')).toHaveText(
    "We don't ship to Yucatán at the moment."
  );
});

test('keeps the pack usable when a line cannot be bought and asks to adjust it', async ({
  page,
}) => {
  await packWith(page, [{ sku: 'E2E-0002', quantity: 3 }]); // only 2 left
  await summary(page).getByLabel('Estado de entrega').selectOption('ZAC');
  await expect(summary(page).locator('[data-shipping]')).toHaveText(
    'Ajusta tu mochila para calcular el envío.'
  );
  await expect(page.locator('main')).toContainText('Solo quedan 2');
});

test.describe('shipping summary on the narrowest phone of the RWD gate (360 px)', () => {
  // Same viewport and rules as mobile-portrait in responsive.spec.ts, here with a filled pack.
  test.use({ viewport: { width: 360, height: 800 } });

  test('the selector and the longest shipping sentence fit without horizontal scroll', async ({
    page,
  }) => {
    await packWith(page, [{ sku: 'E2E-0001', quantity: 1 }], '/en/cart/');
    const state = summary(page).getByLabel('Delivery state');
    await state.selectOption('BCS');
    await expect(summary(page).locator('[data-shipping]')).toHaveText(
      "We don't ship to Baja California Sur at the moment."
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow).toBeLessThanOrEqual(1); // H_SCROLL_TOLERANCE_PX of responsive.spec.ts
    const box = await state.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44); // MIN_TOUCH_TARGET_PX
  });
});
