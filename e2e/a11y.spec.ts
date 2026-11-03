import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockAccountApi } from './support/accountApi';
import { mockQuoteApi } from './support/quoteApi';

/**
 * FC 026 T1.2 A · WCAG 2.0 and 2.1, levels A and AA, measured by axe on the 17 main public
 * routes in Spanish and English, in every project of the matrix (desktop Chrome, iPhone,
 * Android): zero violations on each route.
 *
 * The cart and checkout ask the quote API for prices; it is emulated (e2e/support/quoteApi.ts)
 * so no request ever reaches production. The cookie notice is accepted first: it is audited on
 * its own route below, and on the others it would cover the content axe has to read.
 */

const ROUTES = [
  '/',
  '/nosotros/',
  '/catalogo/',
  '/catalogo/e2e-arnes-alpino/',
  '/carrito/',
  '/checkout/',
  '/privacidad/',
  '/terminos/',
  '/cookies/',
  '/envios-y-devoluciones/',
  '/cuenta/',
  '/en/',
  '/en/about/',
  '/en/catalog/',
  '/en/cart/',
  '/en/checkout/',
  '/en/account/',
];

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** What the cart and checkout pages show once their client state is in (empty in this suite). */
const SETTLED: Readonly<Record<string, string>> = {
  '/carrito/': 'main [data-cart-empty]',
  '/en/cart/': 'main [data-cart-empty]',
  '/checkout/': 'main [data-checkout-empty]',
  '/en/checkout/': 'main [data-checkout-empty]',
  // FC 028: signed out, the account area shows its sign-in form.
  '/cuenta/': 'main form',
  '/en/account/': 'main form',
};

/**
 * FC 039 (270_AN): waits for what axe reads, never for an idle network. `networkidle` needs
 * 500 ms with no request, which WebKit sometimes never reports (run 41542562137). The page is
 * settled when it has loaded, its fonts are in, `main` is shown and, on the cart and checkout,
 * their client state is rendered.
 */
async function settle(page: import('@playwright/test').Page, route: string) {
  await page.waitForLoadState('load');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('main')).toBeVisible();
  const marker = SETTLED[route];
  if (marker) await expect(page.locator(marker)).toBeVisible();
}

/** Rule id, impact and the first offending selectors: enough to find the fix in a CI log. */
async function violationsOn(page: import('@playwright/test').Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .analyze();
  return violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
}

test.describe('WCAG 2.1 AA with axe (FC 026)', () => {
  test.beforeEach(async ({ page }) => {
    await mockQuoteApi(page);
    await mockAccountApi(page);
  });

  for (const route of ROUTES) {
    test(`${route} has no WCAG A/AA violation`, async ({
      page,
      context,
      baseURL,
    }) => {
      await context.addCookies([
        { name: 'yekora_cookie_consent', value: '1', url: baseURL ?? '' },
      ]);
      await page.goto(route);
      await settle(page, route);
      expect(await violationsOn(page)).toEqual([]);
    });
  }

  test('the cookie notice itself has no WCAG A/AA violation', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('region', { name: /cookie/i })).toBeVisible();
    expect(await violationsOn(page)).toEqual([]);
  });
});
