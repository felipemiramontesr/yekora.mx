import { readdirSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/app/i18n';
import { Header } from './Header';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en',
  useRouter: () => ({ push: vi.fn() }),
}));

describe('Header', () => {
  const html = renderToStaticMarkup(
    <Header locale="en" messages={getMessages('en')} />
  );
  const spanish = renderToStaticMarkup(
    <Header locale="es-MX" messages={getMessages('es-MX')} />
  );

  it('uses the client isotype and links home in the current language', () => {
    expect(html).toContain(
      'src="/brand/elements/YEKORA_01_ISOTIPO_MARFIL.svg"'
    );
    expect(html).toContain('src="/brand/elements/YEKORA_02_NOMBRE_MARFIL.svg"');
    expect(html).toMatch(/aria-label="YĒKORA, go to home"[^>]*href="\/en\/"/);
  });

  it('lays the bar out from left to right: logo, delivery, search, account, cart (FC 047 T2.1)', () => {
    const order = [
      'YĒKORA, go to home',
      'Your ZIP',
      'role="search"',
      'My account',
      'Open your pack',
    ].map((text) => html.indexOf(text));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('shows a visitor the invitation to create an account for the postal code, in the same language', () => {
    expect(html).toContain('href="/en/account/?action=register"');
    expect(spanish).toContain('href="/cuenta/?action=register"');
  });

  it('sends the search to the catalog of the language and loads its index from there', () => {
    expect(html).toContain('action="/en/catalog/"');
    expect(html).toContain('role="combobox"');
    expect(spanish).toContain('action="/catalogo/"');
  });

  it('puts the disciplines in a strip under the bar, each leading to its products', () => {
    for (const slug of [
      'senderismo',
      'montana',
      'escalada',
      'canonismo',
      'trail-running',
    ]) {
      expect(html).toContain(`href="/en/catalog/?disciplina=${slug}"`);
      expect(spanish).toContain(`href="/catalogo/?disciplina=${slug}"`);
    }
    expect(html).toContain('Mountaineering');
    expect(spanish).toContain('Cañonismo');
    expect(html.indexOf('role="search"')).toBeLessThan(
      html.indexOf('?disciplina=senderismo')
    );
  });

  it('has no «Catalog» or «About» link, no hamburger and no language switch in the bar', () => {
    const bar = html.slice(0, html.indexOf('</header>'));
    expect(bar).not.toMatch(/>Catalog</);
    expect(bar).not.toMatch(/>About</);
    expect(html).not.toContain('href="/en/about/"');
    expect(bar).not.toContain('>Menu<');
    // The language lives inside the account menu, which is the only <details> of the bar.
    expect(bar.match(/<details/g)).toHaveLength(1);
    expect(bar.indexOf('<details')).toBeLessThan(
      bar.indexOf('aria-label="EN, English"')
    );
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
  'components/AccountMenu.tsx': {
    count: 3,
    reason:
      'the sections of the account area are paths it routes itself (no page per path in the export); inside the area a click changes the view without a reload',
  },
  'components/account/AccountApp.tsx': {
    count: 1,
    reason:
      'the breadcrumb of the account area: its own paths (Apache fallback, no export), changed without a reload',
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
