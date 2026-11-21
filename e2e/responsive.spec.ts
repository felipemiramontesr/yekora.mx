import { expect, test, type Page } from '@playwright/test';
import { mockAccountApi } from './support/accountApi';

/**
 * FC 003 F2 · Gate RWD (Amendment 2, Archon parity). For every public page in both languages
 * and each of the 6 canonical viewports: no horizontal scroll, and on phones and tablets every
 * visible tap target is at least 44 × 44 px. One failing cell fails the build.
 */

const VIEWPORTS = [
  { name: 'mobile-portrait', width: 360, height: 800, touch: true },
  { name: 'mobile-landscape', width: 800, height: 360, touch: true },
  { name: 'tablet-portrait', width: 768, height: 1024, touch: true },
  { name: 'tablet-landscape', width: 1024, height: 768, touch: true },
  { name: 'desktop', width: 1280, height: 800, touch: false },
  { name: 'desktop-wide', width: 1920, height: 1080, touch: false },
];

const PAGES = [
  '/',
  '/nosotros/',
  '/privacidad/',
  '/cookies/',
  '/terminos/',
  '/en/',
  '/en/about/',
  '/en/privacy/',
  '/en/cookies/',
  '/en/terms/',
  // Shipping and returns policy (FC 005).
  '/envios-y-devoluciones/',
  '/en/shipping-and-returns/',
  // Offline fallback pages (FC 007).
  '/offline/',
  '/en/offline/',
  // Catalog (FC 008): 17 routes × 6 viewports = 102 cells. Production ships no product page
  // yet, so product pages are checked in catalog.spec.ts, not here.
  '/catalogo/',
  '/en/catalog/',
  // Cart (FC 009): 19 routes × 6 viewports = 114 cells.
  '/carrito/',
  '/en/cart/',
  // Checkout and its return pages (FC 012): 25 routes × 6 viewports = 150 cells.
  '/checkout/',
  '/en/checkout/',
  // FC 028: the account area, signed out (its sign-in form).
  '/cuenta/',
  '/en/account/',
  '/checkout/exito/',
  '/checkout/cancelado/',
  '/en/checkout/success/',
  '/en/checkout/cancel/',
  // Branded 404 (FC 004): any unknown path.
  '/no-existe/',
];

// Subpixel rounding of the scrollbar, the same tolerance Archon documents.
const H_SCROLL_TOLERANCE_PX = 1;
const MIN_TOUCH_TARGET_PX = 44;

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
}

// Visible links, buttons and summaries smaller than the minimum, described for the report.
async function smallTouchTargets(page: Page): Promise<string[]> {
  return page.evaluate((min) => {
    const targets = [
      ...document.querySelectorAll<HTMLElement>('a[href], button, summary'),
    ];
    return targets
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ element, box }) => element.checkVisibility() && box.width > 0)
      .filter(({ box }) => box.width < min || box.height < min)
      .map(
        ({ element, box }) =>
          `${element.tagName} "${(element.textContent ?? '').trim().slice(0, 30)}" ${Math.round(box.width)}x${Math.round(box.height)}`
      );
  }, MIN_TOUCH_TARGET_PX);
}

for (const viewport of VIEWPORTS) {
  test.describe(`RWD ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const path of PAGES) {
      test(`${path} fits the screen`, async ({ page }) => {
        await mockAccountApi(page);
        await page.goto(path);
        // The cookie notice mounts after hydration; wait so its targets are always measured.
        await expect(
          page.getByRole('region', { name: /cookie/i })
        ).toBeVisible();
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(
          H_SCROLL_TOLERANCE_PX
        );
        if (viewport.touch) {
          expect(await smallTouchTargets(page)).toEqual([]);
        }
      });
    }
  });
}

/**
 * FC 059 · The content keeps half of the side margins a fixed 72 rem (1152 px) box left: from
 * 1152 px up each margin is (w - 1152) / 4, and below it nothing changes (the box is the whole
 * screen). Measured on the containers of the header, the pages and the footer, with no horizontal
 * scroll.
 */
const ADAPTIVE_PATHS = ['/', '/catalogo/', '/cuenta/', '/en/'];

function containerMargins(page: Page) {
  return page.evaluate(() => {
    const width = window.innerWidth;
    return [...document.querySelectorAll('.max-w-adaptive')].map((element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: width - box.right, width: box.width };
    });
  });
}

for (const width of [2544, 1920, 1440, 1152]) {
  test(`at ${width} px each side margin is (w - 1152) / 4 and nothing scrolls sideways (FC 059 T2.1, T2.2)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockAccountApi(page);
    const expected = (width - 1152) / 4;
    for (const path of ADAPTIVE_PATHS) {
      await page.goto(path);
      const boxes = await containerMargins(page);
      expect(boxes.length, path).toBeGreaterThan(0);
      for (const box of boxes) {
        expect(
          Math.abs(box.left - expected),
          `${path} left`
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(box.right - expected),
          `${path} right`
        ).toBeLessThanOrEqual(1);
      }
      expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(
        H_SCROLL_TOLERANCE_PX
      );
    }
  });
}

for (const width of [320, 375, 768, 1024]) {
  test(`at ${width} px the content is the whole screen, as before (FC 059 T2.3)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await mockAccountApi(page);
    for (const path of ADAPTIVE_PATHS) {
      await page.goto(path);
      for (const box of await containerMargins(page)) {
        expect(box.left, path).toBeLessThanOrEqual(1);
        expect(box.right, path).toBeLessThanOrEqual(1);
        expect(box.width, path).toBeGreaterThanOrEqual(width - 2);
      }
    }
  });
}

test('on a 4K screen the content grows to (w + 1152) / 2 and nothing scrolls sideways (FC 059 T2.2)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 3840, height: 1200 });
  await mockAccountApi(page);
  await page.goto('/');
  const boxes = await containerMargins(page);
  for (const box of boxes) {
    expect(Math.abs(box.width - (3840 + 1152) / 2)).toBeLessThanOrEqual(2);
  }
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(
    H_SCROLL_TOLERANCE_PX
  );
});
