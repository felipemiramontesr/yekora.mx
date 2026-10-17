import { expect, test, type Page } from '@playwright/test';

/**
 * FC 004 · Tier 2 invariant I-HeroContrast:
 *   ∀ x ∈ Hero_Text_Region : Contrast(Text_Color, Effective_Background(x)) ≥ 4.5:1
 *
 * Measured on rendered pixels, not on hex values: the hero heading and lede are made
 * transparent, their boxes are screenshotted with the backdrop drawing and the petróleo
 * overlay behind them, and every pixel is checked against the text color as the browser
 * composites it (the lede is ivory at 90 % opacity, so its effective color depends on the
 * pixel underneath). The domain is finite: each pixel of both boxes in each canonical viewport.
 */

const VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 800, height: 360 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];
const WCAG_AA = 4.5;

// The cookie notice is fixed to the bottom and can cover the lede on short screens; it is not
// part of the hero background, so the measurement runs with the notice already accepted.
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    { name: 'yekora_cookie_consent', value: '1', url: baseURL ?? '' },
  ]);
});

/** Lowest contrast between the hidden text and any pixel behind it, for one element. */
async function minContrastBehind(page: Page, selector: string) {
  const element = page.locator(selector);
  const color = await element.evaluate((node) => getComputedStyle(node).color);
  const box = await element.boundingBox();
  if (!box) throw new Error(`${selector} is not rendered`);
  await element.evaluate((node) => {
    (node as HTMLElement).style.color = 'transparent';
  });
  // fullPage lets the clip reach text below the fold (e.g. the lede at 800x360).
  const shot = await page.screenshot({ clip: box, fullPage: true });
  await element.evaluate((node) => {
    (node as HTMLElement).style.color = '';
  });
  return page.evaluate(
    async ({ png, textColor }) => {
      const [r, g, b, a = 1] = (textColor.match(/[\d.]+/g) ?? []).map(Number);
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d context');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      const channel = (value: number) => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const luminance = (red: number, green: number, blue: number) =>
        0.2126 * channel(red) +
        0.7152 * channel(green) +
        0.0722 * channel(blue);
      let min = Infinity;
      for (let i = 0; i < pixels.length; i += 4) {
        const [br, bg, bb] = [pixels[i], pixels[i + 1], pixels[i + 2]];
        const text = luminance(
          a * r + (1 - a) * br,
          a * g + (1 - a) * bg,
          a * b + (1 - a) * bb
        );
        const back = luminance(br, bg, bb);
        const ratio =
          (Math.max(text, back) + 0.05) / (Math.min(text, back) + 0.05);
        min = Math.min(min, ratio);
      }
      return min;
    },
    { png: shot.toString('base64'), textColor: color }
  );
}

for (const viewport of VIEWPORTS) {
  test(`hero text keeps WCAG AA contrast at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    for (const path of ['/', '/en/']) {
      await page.goto(path);
      for (const selector of ['[data-hero] h1', '[data-hero] h1 + p']) {
        const ratio = await minContrastBehind(page, selector);
        test.info().annotations.push({
          type: 'contrast',
          description: `${path} ${selector}: ${ratio.toFixed(2)}:1`,
        });
        expect(ratio).toBeGreaterThanOrEqual(WCAG_AA);
      }
    }
  });
}
