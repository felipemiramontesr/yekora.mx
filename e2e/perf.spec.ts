import { expect, test, type Page } from '@playwright/test';
import { mockAccountApi } from './support/accountApi';

/**
 * FC 043 T0.1 and T2.1 · Core Web Vitals budget of the key pages on a phone: the cumulative
 * layout shift stays at or under 0.10 and the largest contentful paint at or under 2500 ms.
 *
 * Measured on the Android project only, with the CPU slowed 4× through the Chrome DevTools
 * Protocol (a mid-range phone): `E2E_PERF=1 playwright test --project=mobile-chrome --workers=1
 * e2e/perf.spec.ts`, its own CI step (playwright.local.config.ts ignores this file otherwise).
 * WebKit has no CDP and reports neither metric; desktop Chrome is not the budget's device. The site is the static export the
 * suite already serves, so the network is local: the budget guards what the code does (late
 * content pushing the page, heavy scripts delaying the paint), not Hostinger's latency, which
 * 322_AN measures in production.
 */

// Recording a video or a trace takes CPU from the page being timed: off for this suite.
test.use({ video: 'off', trace: 'off' });

/** Pages under the budget (FC 043 T2.1). */
const PAGES = ['/', '/catalogo/', '/cuenta/'] as const;

/** Budget of FC 043 T0.1. */
const MAX_CLS = 0.1;
const MAX_LCP_MS = 2500;

/** Starts both observers before any script of the page runs. */
async function observeVitals(page: Page) {
  await page.addInitScript(() => {
    const vitals = { cls: 0, lcp: 0 };
    Object.assign(window, { vitals });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
      })[]) {
        if (!entry.hadRecentInput) vitals.cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      const last = list.getEntries().at(-1);
      if (last) vitals.lcp = last.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
}

for (const path of PAGES) {
  test(`${path} stays within CLS ${MAX_CLS} and LCP ${MAX_LCP_MS} ms on a phone (FC 043 T2.1)`, async ({
    page,
  }, testInfo) => {
    // Signed out, as a first visit: /cuenta/ asks the emulated API who is signed in.
    await mockAccountApi(page);
    await observeVitals(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    // The page's final state: on /cuenta/ the sign-in form is enabled once hydrated (T2.2).
    if (path === '/cuenta/') {
      await expect(page.getByLabel('Correo electrónico')).toBeEnabled();
    }
    // A shift after hydration would be late content pushing the page: give it a frame to land.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
    const vitals = await page.evaluate(
      () =>
        (window as Window & { vitals?: { cls: number; lcp: number } }).vitals
    );
    testInfo.annotations.push({
      type: 'vitals',
      description: `${path} CLS ${vitals?.cls.toFixed(3)} · LCP ${Math.round(vitals?.lcp ?? 0)} ms`,
    });
    expect(vitals?.lcp, 'LCP was never reported').toBeGreaterThan(0);
    expect(vitals?.cls).toBeLessThanOrEqual(MAX_CLS);
    expect(vitals?.lcp).toBeLessThanOrEqual(MAX_LCP_MS);
  });
}
