import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('app/globals.css', 'utf8');

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  return start < 0
    ? ''
    : css.slice(css.indexOf('{', start), css.indexOf('}', start));
}

// FC 059 T1.1: the adaptive width of the content, half the side margins of a fixed 72 rem box.
describe('the adaptive container of the stylesheet (FC 059)', () => {
  it('is (100vw + 72rem) / 2, never wider than its parent, and centred', () => {
    const body = rule('.max-w-adaptive');
    expect(body).toContain('max-width: min(100%, calc(50vw + 36rem))');
    expect(body).toContain('margin-inline: auto');
  });

  it('leaves no page container at the fixed 72 rem or 64 rem it replaced', () => {
    const containers = [
      'app/global-not-found.tsx',
      'components/BrandBanner.tsx',
      'components/Footer.tsx',
      'components/Header.tsx',
      'components/views/AccountView.tsx',
      'components/views/CatalogView.tsx',
      'components/views/CheckoutView.tsx',
      'components/views/HomeView.tsx',
      'components/views/ProductView.tsx',
    ];
    for (const file of containers) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).toContain('max-w-adaptive');
      expect(source, file).not.toMatch(/max-w-(5xl|6xl)/);
    }
  });
});
