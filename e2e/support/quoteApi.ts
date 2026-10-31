import type { Page, Route } from '@playwright/test';
import fixture from '../fixtures/catalog.json' with { type: 'json' };

/**
 * The quote API as the E2E suites see it (FC 009, FC 011): intercepted in the browser and
 * answered with the server's own formula (apps/api/src/services/cartQuote.ts) over
 * e2e/fixtures/catalog.json, so no test ever reaches production. It emulates the rate tables
 * (one flat-by-state rule set and free shipping from a threshold) and truth table T1.1 (400
 * when a line cannot be bought). Shared by cart.spec.ts and checkout.spec.ts.
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

/**
 * Answers `POST /v1/cart/quote` in this page like the API would, or refuses the connection.
 *
 * @param page - Page to intercept in.
 * @param mode - `down` makes the API unreachable.
 */
export async function mockQuoteApi(page: Page, mode: 'ok' | 'down' = 'ok') {
  await page.route(
    'https://apiv1.yekora.mx/v1/cart/quote**',
    async (route: Route) => {
      if (mode === 'down') return route.abort('connectionrefused');
      // FC 026: the CORS preflight of the JSON POST, answered as the real API does. WebKit
      // sends it through the interception; Chromium does not.
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': 'http://localhost:3100',
            'access-control-allow-methods': 'POST, OPTIONS',
            'access-control-allow-headers': 'content-type',
          },
        });
      }
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
