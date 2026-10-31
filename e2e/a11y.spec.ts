import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockQuoteApi } from './support/quoteApi';

/**
 * FC 026 T1.2 A · WCAG 2.0 and 2.1, levels A and AA, measured by axe on the 15 main public
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
  '/en/',
  '/en/about/',
  '/en/catalog/',
  '/en/cart/',
  '/en/checkout/',
];

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

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
      await page.waitForLoadState('networkidle');
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
