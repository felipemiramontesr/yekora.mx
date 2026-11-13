import { readdirSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/app/i18n';
import { Header } from './Header';

vi.mock('next/navigation', () => ({ usePathname: () => '/en' }));

describe('Header', () => {
  const html = renderToStaticMarkup(
    <Header locale="en" messages={getMessages('en')} />
  );

  it('uses the client isotype and links home in the current language', () => {
    expect(html).toContain(
      'src="/brand/elements/YEKORA_01_ISOTIPO_MARFIL.svg"'
    );
    expect(html).toContain('src="/brand/elements/YEKORA_02_NOMBRE_MARFIL.svg"');
    expect(html).toContain(
      'aria-label="YĒKORA, go to home" class="tap-target shrink-0 gap-3" href="/en/"'
    );
  });

  it('anchors every discipline inside the current language', () => {
    for (const anchor of [
      'senderismo',
      'montana',
      'escalada',
      'canonismo',
      'trail-running',
    ]) {
      expect(html).toContain(`href="/en/#${anchor}"`);
    }
    expect(html).toContain('Mountaineering');
    expect(html).toContain('href="/en/about/"');
  });

  it('links the catalog in the current language (FC 008)', () => {
    expect(html).toContain('href="/en/catalog/"');
    expect(html).not.toContain('/catalogo');
    expect(html).not.toContain('Coming soon');
  });

  it('renders the mobile menu without client JavaScript', () => {
    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    expect(html).toContain('Menu');
  });

  it('renders the Spanish copy for es-MX', () => {
    const spanish = renderToStaticMarkup(
      <Header locale="es-MX" messages={getMessages('es-MX')} />
    );
    expect(spanish).toContain('href="/#canonismo"');
    expect(spanish).toContain('Cañonismo');
    expect(spanish).toContain('href="/catalogo/"');
  });
});

/**
 * Every `<a` left in the site's components, by file, with the reason it is not a `next/link`
 * (FC 043 T2.3). A new plain anchor fails here until it is moved to `Link` or listed with its reason.
 */
const PLAIN_ANCHORS: Record<string, { count: number; reason: string }> = {
  'app/global-not-found.tsx': {
    count: 1,
    reason: 'standalone document outside both root layouts',
  },
  'components/LanguageSwitcher.tsx': {
    count: 1,
    reason: 'each language has its own root layout: another document',
  },
  'components/cart/CartButton.tsx': {
    count: 1,
    reason:
      'its click opens the cart drawer; the href is the no-script fallback',
  },
  'components/checkout/CheckoutForm.tsx': {
    count: 2,
    reason: 'legal texts open in a new tab (target="_blank")',
  },
  'components/account/AccountSidebar.tsx': {
    count: 1,
    reason:
      'sidebar sections: the area routes its own paths (Apache fallback, no export)',
  },
  'components/account/AccountOrders.tsx': {
    count: 1,
    reason: 'order links inside the account area, same in-area router',
  },
  'components/account/AccountForms.tsx': {
    count: 1,
    reason: 'otpauth:// URI for the authenticator app, not a page',
  },
};

/** All non-test `.tsx` files under a folder, as repository-relative paths. */
function sourcesUnder(folder: string): string[] {
  return readdirSync(folder, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
    .map((file) => `${folder}/${file.replaceAll('\\', '/')}`);
}

describe('internal navigation (FC 043 T2.3)', () => {
  const found = Object.fromEntries(
    [...sourcesUnder('app'), ...sourcesUnder('components')]
      .map(
        (file) =>
          [
            file,
            readFileSync(file, 'utf8').match(/<a\b/g)?.length ?? 0,
          ] as const
      )
      .filter(([, count]) => count > 0)
  );

  it('uses next/link for every internal link, except the listed plain anchors', () => {
    expect(found).toEqual(
      Object.fromEntries(
        Object.entries(PLAIN_ANCHORS).map(([file, { count }]) => [file, count])
      )
    );
  });
});
