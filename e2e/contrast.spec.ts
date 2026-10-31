import { inflateSync } from 'node:zlib';
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
  const [r, g, b, a = 1] = (color.match(/[\d.]+/g) ?? []).map(Number);
  const { pixels, channels } = decodePng(shot);
  let min = Infinity;
  for (let i = 0; i < pixels.length; i += channels) {
    const [br, bg, bb] = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const text = luminance(
      a * r + (1 - a) * br,
      a * g + (1 - a) * bg,
      a * b + (1 - a) * bb
    );
    const back = luminance(br, bg, bb);
    const ratio = (Math.max(text, back) + 0.05) / (Math.min(text, back) + 0.05);
    min = Math.min(min, ratio);
  }
  return min;
}

/** sRGB channel (0–255) to linear light, as WCAG 2 defines relative luminance. */
function channel(value: number) {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(red: number, green: number, blue: number) {
  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  );
}

/**
 * FC 026: the screenshot is decoded here in Node (zlib), not in a page canvas, so the same
 * measurement runs on every engine; WebKit never finished the canvas decode. Playwright writes
 * 8-bit, non-interlaced RGB or RGBA PNGs; each scanline carries one of the five PNG filters.
 */
function decodePng(png: Buffer): { pixels: Uint8Array; channels: number } {
  const { width, height, channels, data } = readChunks(png);
  const raw = inflateSync(data);
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft =
        x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      pixels[y * stride + x] =
        (value + predictor(filter, left, up, upLeft)) & 0xff;
    }
  }
  return { pixels, channels };
}

/** Size and format from IHDR, and the compressed image data of every IDAT, in order. */
function readChunks(png: Buffer) {
  let offset = 8; // PNG signature
  let header: Buffer | undefined;
  const data: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = body;
    if (type === 'IDAT') data.push(body);
    offset += 12 + length;
  }
  if (header === undefined) throw new Error('PNG without IHDR');
  const [depth, colorType, , , interlace] = header.subarray(8, 13);
  if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error('only 8-bit, non-interlaced RGB or RGBA PNGs');
  }
  return {
    width: header.readUInt32BE(0),
    height: header.readUInt32BE(4),
    channels: colorType === 6 ? 4 : 3,
    data: Buffer.concat(data),
  };
}

/** The value a PNG filter adds back to each byte (None, Sub, Up, Average, Paeth). */
function predictor(filter: number, left: number, up: number, upLeft: number) {
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return Math.floor((left + up) / 2);
  if (filter === 4) {
    const p = left + up - upLeft;
    const [pa, pb, pc] = [
      Math.abs(p - left),
      Math.abs(p - up),
      Math.abs(p - upLeft),
    ];
    if (pa <= pb && pa <= pc) return left;
    return pb <= pc ? up : upLeft;
  }
  return 0;
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
