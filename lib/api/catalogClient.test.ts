import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '@/e2e/fixtures/catalog.json';
import { fetchCatalog, isAllowedApiBase } from './catalogClient';

const [harness, backpack] = fixture.products.en;
const FIX = fixture.exchangeRate;
const BASE = 'https://apiv1.yekora.mx';

// The listing returns products without their gallery.
function listItem(product: typeof harness) {
  const item: Partial<typeof harness> = { ...product };
  delete item.images;
  return item;
}

/** Fake API: answers each path from a table and records the requests. */
function fakeApi(routes: Record<string, unknown>, status = 200) {
  return vi.fn(async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    const body = routes[url.pathname + url.search];
    return body === undefined
      ? new Response('{}', { status: 404 })
      : new Response(JSON.stringify(body), { status });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('isAllowedApiBase', () => {
  it.each([
    ['https://apiv1.yekora.mx', true],
    ['http://localhost:3091', true],
    ['http://127.0.0.1:3091', true],
    ['not a url', false],
  ])('%s → %s', (base, allowed) => {
    expect(isAllowedApiBase(base)).toBe(allowed);
  });

  // Insecure schemes are the negatives under test, so they are built by downgrading https.
  it.each(['http:', 'ftp:'])(
    'refuses the production host downgraded to %s',
    (protocol) => {
      const url = new URL(BASE);
      url.protocol = protocol;
      expect(url.protocol).toBe(protocol);
      expect(isAllowedApiBase(url.href)).toBe(false);
    }
  );
});

describe('fetchCatalog', () => {
  it('reads every listing page, then each product detail, validated', async () => {
    const api = fakeApi({
      '/v1/catalog?lang=en&page=1&pageSize=48': {
        items: [listItem(harness)],
        page: 1,
        pageSize: 48,
        total: 2,
        exchangeRate: FIX,
      },
      '/v1/catalog?lang=en&page=2&pageSize=48': {
        items: [listItem(backpack)],
        page: 2,
        pageSize: 48,
        total: 2,
        exchangeRate: FIX,
      },
      '/v1/catalog/e2e-arnes-alpino?lang=en': { ...harness, exchangeRate: FIX },
      '/v1/catalog/e2e-mochila-ligera-28l?lang=en': {
        ...backpack,
        images: [{ path: '/images/products/mochila.webp', alt: 'Backpack' }],
        exchangeRate: FIX,
      },
    });
    const catalog = await fetchCatalog(BASE, 'en', api);
    expect(catalog.exchangeRate).toEqual(FIX);
    expect(catalog.products.map((p) => p.slug)).toEqual([
      'e2e-arnes-alpino',
      'e2e-mochila-ligera-28l',
    ]);
    expect(catalog.products[0].priceUsdCents).toBe(26216);
    expect(catalog.products[1].images).toEqual([
      { path: '/images/products/mochila.webp', alt: 'Backpack' },
    ]);
    const [, init] = api.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.headers).toEqual({ Accept: 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('accepts an empty catalog without a FIX (production until K-07)', async () => {
    const api = fakeApi({
      '/v1/catalog?lang=es-MX&page=1&pageSize=48': {
        items: [],
        page: 1,
        pageSize: 48,
        total: 0,
        exchangeRate: null,
      },
    });
    await expect(fetchCatalog(BASE, 'es-MX', api)).resolves.toEqual({
      exchangeRate: null,
      products: [],
    });
    expect(api).toHaveBeenCalledOnce();
  });

  it('stops on an empty page even if the total says more (no endless loop)', async () => {
    const api = fakeApi({
      '/v1/catalog?lang=en&page=1&pageSize=48': {
        items: [],
        page: 1,
        pageSize: 48,
        total: 5,
        exchangeRate: null,
      },
    });
    await expect(fetchCatalog(BASE, 'en', api)).resolves.toMatchObject({
      products: [],
    });
  });

  it('fails the build on a non-2xx answer', async () => {
    const api = fakeApi({ '/v1/catalog?lang=en&page=1&pageSize=48': {} }, 503);
    await expect(fetchCatalog(BASE, 'en', api)).rejects.toThrow(
      'Catalog API answered 503 for /v1/catalog?lang=en&page=1&pageSize=48'
    );
  });

  it('fails the build when the API breaks its contract', async () => {
    const api = fakeApi({
      '/v1/catalog?lang=en&page=1&pageSize=48': {
        items: [{ ...listItem(harness), priceMxnCents: -1 }],
        page: 1,
        pageSize: 48,
        total: 1,
        exchangeRate: FIX,
      },
    });
    await expect(fetchCatalog(BASE, 'en', api)).rejects.toThrow();
  });

  it('rejects an image outside the site (only /images/products/)', async () => {
    const api = fakeApi({
      '/v1/catalog?lang=en&page=1&pageSize=48': {
        items: [listItem(harness)],
        page: 1,
        pageSize: 48,
        total: 1,
        exchangeRate: FIX,
      },
      '/v1/catalog/e2e-arnes-alpino?lang=en': {
        ...harness,
        images: [{ path: 'https://evil.example/x.webp', alt: '' }],
        exchangeRate: FIX,
      },
    });
    await expect(fetchCatalog(BASE, 'en', api)).rejects.toThrow();
  });

  it('uses the global fetch by default', async () => {
    vi.stubGlobal(
      'fetch',
      fakeApi({
        '/v1/catalog?lang=en&page=1&pageSize=48': {
          items: [],
          page: 1,
          pageSize: 48,
          total: 0,
          exchangeRate: null,
        },
      })
    );
    await expect(fetchCatalog(BASE, 'en')).resolves.toEqual({
      exchangeRate: null,
      products: [],
    });
  });
});
