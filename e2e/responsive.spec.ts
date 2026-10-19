import { expect, test, type Page } from '@playwright/test';

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
