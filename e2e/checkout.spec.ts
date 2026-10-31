import { expect, test, type Page, type Request } from '@playwright/test';
import { mockQuoteApi } from './support/quoteApi';

/**
 * FC 012 F4 · Guest checkout and return pages, on the static export. The quote API is the
 * cart's emulation (e2e/support/quoteApi.ts); `POST /v1/checkout`, `GET /v1/orders/:n` and the
 * hosted pages of Stripe and Mercado Pago are intercepted here, so no test ever reaches a
 * processor or production. Stock reservation, lazy expiry and concurrency are proven against
 * MariaDB in the API suites (F2); here the browser shows what the API answers about them.
 */

const ORDER = 'YEK-2026-AB12CD34';
const TOKEN = 'k'.repeat(43);
const STRIPE_PAGE = 'https://checkout.stripe.com/c/pay/cs_test_e2e';
const MP_PAGE =
  'https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=e2e';
const CORS = { 'access-control-allow-origin': 'http://localhost:3100' };

/**
 * FC 026: the CORS preflight the browser sends before a JSON POST or an Authorization header,
 * answered as the real API does. WebKit sends it through the interception; Chromium does not.
 */
const PREFLIGHT = {
  status: 204,
  headers: {
    ...CORS,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
  },
};

type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'NEEDS_REVIEW';

interface Backend {
  /** Bodies sent to `POST /v1/checkout`. */
  checkouts: Record<string, unknown>[];
  /** `Authorization` headers sent to the order endpoint. */
  authorizations: (string | null)[];
  /** Every URL the page requested. */
  urls: string[];
}

interface BackendOptions {
  /** Answer of `POST /v1/checkout`: a session to this page, or a refusal code. */
  checkout?: { redirectUrl: string } | { status: number; code: string };
  /** Successive statuses of the order (the last one repeats). */
  statuses?: OrderStatus[];
  /** Method of the order the return pages read. */
  method?: string;
}

/** Intercepts the checkout, the order view and both hosted payment pages. */
async function backend(
  page: Page,
  options: BackendOptions = {}
): Promise<Backend> {
  const seen: Backend = { checkouts: [], authorizations: [], urls: [] };
  const statuses = [...(options.statuses ?? ['PENDING_PAYMENT'])];
  page.on('request', (request: Request) => seen.urls.push(request.url()));
  await mockQuoteApi(page);
  await page.route('https://apiv1.yekora.mx/v1/checkout**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill(PREFLIGHT);
    seen.checkouts.push(route.request().postDataJSON());
    const answer = options.checkout ?? { redirectUrl: STRIPE_PAGE };
    if ('code' in answer) {
      return route.fulfill({
        status: answer.status,
        contentType: 'application/problem+json',
        headers: CORS,
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Refused',
          status: answer.status,
          detail: answer.code,
        }),
      });
    }
    return route.fulfill({
      status: 201,
      headers: CORS,
      json: {
        orderNumber: ORDER,
        accessToken: TOKEN,
        redirectUrl: answer.redirectUrl,
        expiresAt: '2026-10-24T19:00:00.000Z',
        totalMxnCents: 500000,
      },
    });
  });
  await page.route('https://apiv1.yekora.mx/v1/orders/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill(PREFLIGHT);
    seen.authorizations.push(
      await route.request().headerValue('authorization')
    );
    const status = statuses.length > 1 ? statuses.shift() : statuses[0];
    return route.fulfill({
      headers: CORS,
      json: {
        orderNumber: ORDER,
        status,
        method: options.method ?? 'CARD',
        itemsTotalMxnCents: 485000,
        shippingTotalMxnCents: 15000,
        totalMxnCents: 500000,
        expiresAt: '2026-10-24T19:00:00.000Z',
        paidAt: status === 'PAID' ? '2026-10-21T19:10:00.000Z' : null,
      },
    });
  });
  for (const [host, title] of [
    ['https://checkout.stripe.com/**', 'Stripe test page'],
    ['https://www.mercadopago.com.mx/**', 'Mercado Pago test page'],
  ]) {
    await page.route(host, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><title>${title}</title><h1>${title}</h1>`,
      })
    );
  }
  return seen;
}

/** Opens a page with a harness in the pack and Zacatecas as the delivery state. */
async function withPack(page: Page, path: string) {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(
        'yekora_cart_v1',
        JSON.stringify([{ sku: 'E2E-0001', quantity: 1 }])
      );
      localStorage.setItem('yekora_shipping_state_v1', 'ZAC');
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto(path);
}

/** Fills the Spanish form with a valid buyer and the given method. */
async function fillBuyer(page: Page, method: RegExp) {
  const form = page.locator('main form');
  await form.getByLabel('Nombre completo').fill('Ana Flores');
  await form.getByLabel('Correo electrónico').fill('ana@example.com');
  await form.getByLabel('Teléfono').fill('4929421780');
  await form.getByLabel('Calle').fill('Av. Barones');
  await form.getByLabel('Número exterior').fill('209');
  await form.getByLabel('Colonia').fill('Las Américas');
  await form.getByLabel('Municipio o alcaldía').fill('Guadalupe');
  await form.getByLabel('Código postal').fill('98612');
  await form.getByRole('radio', { name: method }).check();
  await form.getByRole('checkbox').check();
}

const payButton = (page: Page) =>
  page.getByRole('button', { name: 'Ir a pagar $5,000.00 MXN' });

test('buys by card: cart → checkout → Stripe → paid, with the token only in Authorization', async ({
  page,
}) => {
  const seen = await backend(page, { statuses: ['PENDING_PAYMENT', 'PAID'] });
  await withPack(page, '/carrito/');
  await page.getByRole('link', { name: 'Continuar al pago' }).click();
  await expect(page).toHaveURL('/checkout/');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex, nofollow'
  );
  await fillBuyer(page, /Tarjeta de crédito o débito/);
  await payButton(page).click();
  await expect(page).toHaveURL(STRIPE_PAGE);
  expect(seen.checkouts).toEqual([
    {
      items: [{ sku: 'E2E-0001', quantity: 1 }],
      method: 'CARD',
      customer: {
        name: 'Ana Flores',
        email: 'ana@example.com',
        phone: '4929421780',
      },
      address: {
        street: 'Av. Barones',
        exteriorNumber: '209',
        neighborhood: 'Las Américas',
        municipality: 'Guadalupe',
        stateCode: 'ZAC',
        postalCode: '98612',
      },
      privacyConsent: true,
      expectedTotalMxnCents: 500000,
    },
  ]);

  // Stripe sends the buyer back to the success URL the API gave it.
  await page.goto('/checkout/exito/');
  await expect(page.locator('main')).toContainText(`Pedido ${ORDER}`);
  await expect(page.locator('main')).toContainText(
    'Esta página se actualiza sola'
  );
  await expect(page.locator('main')).toContainText('¡Pago confirmado!', {
    timeout: 10_000,
  });
  await expect(
    page.getByRole('banner').getByRole('link', { name: /Abrir tu mochila/ })
  ).toHaveAccessibleName('Abrir tu mochila, 0 productos');
  expect(seen.authorizations.every((h) => h === `Bearer ${TOKEN}`)).toBe(true);
  expect(seen.urls.filter((url) => url.includes(TOKEN))).toEqual([]);
  // The browser keeps the access in this tab only, and no personal data at all.
  const stored = await page.evaluate(() => ({
    session: sessionStorage.getItem('yekora_order_access_v1'),
    local: Object.values({ ...localStorage }).join(' '),
  }));
  expect(stored.session).toContain(ORDER);
  expect(stored.local).not.toMatch(/Ana|Barones|4929421780|example\.com/);
});

test('SPEI goes to Mercado Pago; back from cancel, the same payment page is offered', async ({
  page,
}) => {
  const seen = await backend(page, {
    checkout: { redirectUrl: MP_PAGE },
    method: 'SPEI',
  });
  await withPack(page, '/checkout/');
  await fillBuyer(page, /Transferencia SPEI/);
  await payButton(page).click();
  await expect(page).toHaveURL(MP_PAGE);
  expect(seen.checkouts[0]).toMatchObject({ method: 'SPEI' });

  await page.goto('/checkout/cancelado/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'No se completó el pago'
  );
  await expect(page.locator('main')).toContainText(
    'Completa tu pago antes del 24 de octubre de 2026'
  );
  // Leaving the processor is not paying: the pack stays as it was.
  await expect(
    page.getByRole('banner').getByRole('link', { name: /Abrir tu mochila/ })
  ).toHaveAccessibleName('Abrir tu mochila, 1 producto');
  await page
    .getByRole('button', { name: 'Volver a la página de pago' })
    .click();
  await expect(page).toHaveURL(MP_PAGE);
  expect(seen.checkouts).toHaveLength(1);
});

test('an order that lapsed before payment reads as expired, with nothing charged', async ({
  page,
}) => {
  await backend(page, { statuses: ['EXPIRED'], method: 'OXXO' });
  await withPack(page, '/checkout/');
  await fillBuyer(page, /Efectivo en OXXO/);
  await payButton(page).click();
  await expect(page).toHaveURL(STRIPE_PAGE);
  await page.goto('/checkout/exito/');
  await expect(page.locator('main')).toContainText(
    'El plazo para pagar este pedido terminó y liberamos los productos. No se hizo ningún cargo.'
  );
  await expect(
    page.getByRole('button', { name: 'Volver a la página de pago' })
  ).toHaveCount(0);
});

test('the last unit taken by another buyer: explains it, re-quotes, and stays here', async ({
  page,
}) => {
  const seen = await backend(page, {
    checkout: { status: 409, code: 'INSUFFICIENT_STOCK' },
  });
  let quotes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/v1/cart/quote')) quotes += 1;
  });
  await withPack(page, '/checkout/');
  await fillBuyer(page, /Tarjeta de crédito o débito/);
  await expect(payButton(page)).toBeEnabled();
  const before = quotes;
  await payButton(page).click();
  await expect(page.locator('main')).toContainText(
    'Alguien acaba de llevarse una de tus piezas. Revisa tu mochila.'
  );
  await expect.poll(() => quotes).toBeGreaterThan(before);
  await expect(page).toHaveURL('/checkout/');
  expect(seen.checkouts).toHaveLength(1);
});

test('refuses to navigate to a page that is not Stripe or Mercado Pago', async ({
  page,
}) => {
  await backend(page, {
    checkout: { redirectUrl: 'https://evil.example/pay' },
  });
  await withPack(page, '/checkout/');
  await fillBuyer(page, /Tarjeta de crédito o débito/);
  await payButton(page).click();
  await expect(page.locator('main')).toContainText(
    'No pudimos iniciar tu pago. Intenta de nuevo.'
  );
  await expect(page).toHaveURL('/checkout/');
  expect(
    await page.evaluate(() => sessionStorage.getItem('yekora_order_access_v1'))
  ).toBeNull();
});

test('shows what is missing, focuses it, and sends nothing', async ({
  page,
}) => {
  const seen = await backend(page);
  await withPack(page, '/checkout/');
  await expect(payButton(page)).toBeEnabled();
  await payButton(page).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Revisa los campos marcados.' })
  ).toHaveText('Revisa los campos marcados.');
  await expect(page.getByLabel('Nombre completo')).toBeFocused();
  await expect(page.getByLabel('Nombre completo')).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  await expect(page.locator('main')).toContainText('Elige cómo quieres pagar.');
  expect(seen.checkouts).toEqual([]);
});

test('a state without shipping blocks paying until another state is chosen', async ({
  page,
}) => {
  await backend(page);
  await withPack(page, '/checkout/');
  await page.getByLabel('Estado').selectOption('JAL');
  await expect(page.getByRole('button', { name: /Ir a pagar/ })).toBeDisabled();
  await expect(page.locator('main')).toContainText(
    'Elige un estado al que enviemos para calcular el total.'
  );
  await page.getByLabel('Estado').selectOption('ZAC');
  await expect(payButton(page)).toBeEnabled();
});

test('works in English and under the CSP without a violation', async ({
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
  await backend(page, { statuses: ['PAID'] });
  await withPack(page, '/en/checkout/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Checkout');
  await expect(
    page.getByRole('button', { name: 'Pay $5,000.00 MXN' })
  ).toBeEnabled();
  await page.goto('/en/checkout/success/');
  // No order was placed in this tab: the page says so instead of guessing.
  await expect(page.locator('main')).toContainText(
    'We could not find a recent order in this browser tab.'
  );
  expect(violations).toEqual([]);
});

test.describe('the filled checkout on the narrowest phone of the RWD gate (360 px)', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('form, errors and summary fit without horizontal scroll', async ({
    page,
  }) => {
    await backend(page);
    await withPack(page, '/checkout/');
    await payButton(page).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Revisa los campos marcados.' })
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      )
    ).toBeLessThanOrEqual(1);
  });
});
