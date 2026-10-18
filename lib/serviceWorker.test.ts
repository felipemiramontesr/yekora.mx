/**
 * Unit tests of public/sw.js (FC 007). The worker is imported as a fresh module per test, with
 * `self`, `caches` and `fetch` stubbed as globals. Truth table T1.1, the cache strategies, the
 * offline fallback and the version purge (I-Cache-Purge) are checked without a browser.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://yekora.mx';
const SOURCE = readFileSync('public/sw.js', 'utf8');
const CACHE = 'yekora-__BUILD_SHA__';
// What the precache downloads for each offline page: real exports reference their chunks,
// styles and fonts with src/href attributes (shared chunks may repeat across pages).
const OFFLINE_HTML: Record<string, string> = {
  '/offline/':
    '<link rel="stylesheet" href="/_next/static/css/site.css"/><script src="/_next/static/chunks/offline-es.js" async></script>',
  '/en/offline/':
    '<link rel="preload" href="/_next/static/media/inter.woff2"/><script src="/_next/static/chunks/offline-en.js" async></script><script src="/_next/static/chunks/offline-es.js"></script>',
};
// A classic worker script, not a module: kept in a variable so tsc does not resolve it.
const WORKER_PATH = '../public/sw.js';

interface FakeRequest {
  method: string;
  url: string;
  mode: string;
}

const online = async (request: FakeRequest) =>
  new Response(`fresh ${new URL(request.url).pathname}`);
const offline: typeof online = async () => {
  throw new TypeError('network down');
};

async function loadWorker(fetchImpl: typeof online) {
  const handlers = new Map<string, CallableFunction>();
  const store = new Map<string, Map<string, Response>>();
  const keyOf = (request: FakeRequest | string) =>
    typeof request === 'string' ? new URL(request, ORIGIN).href : request.url;
  vi.stubGlobal('caches', {
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      const entries = store.get(name)!;
      return {
        match: async (request: FakeRequest | string) =>
          entries.get(keyOf(request))?.clone(),
        put: async (request: FakeRequest, response: Response) => {
          entries.set(keyOf(request), response);
        },
        addAll: async (urls: string[]) => {
          for (const url of urls) {
            entries.set(keyOf(url), new Response(OFFLINE_HTML[url] ?? url));
          }
        },
      };
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
  });
  const fetch = vi.fn(fetchImpl);
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('self', {
    location: new URL(ORIGIN),
    addEventListener: (type: string, handler: CallableFunction) => {
      handlers.set(type, handler);
    },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  });
  vi.resetModules();
  await import(/* @vite-ignore */ WORKER_PATH);

  /** Dispatches a fetch event; resolves to the response, or undefined when not intercepted. */
  async function request(path: string, method = 'GET', mode = 'navigate') {
    let responded: Promise<Response> | undefined;
    handlers.get('fetch')?.({
      request: { method, mode, url: new URL(path, ORIGIN).href },
      respondWith: (promise: Promise<Response>) => {
        responded = promise;
      },
    });
    return responded;
  }

  async function lifecycle(type: 'install' | 'activate') {
    let done: Promise<unknown> = Promise.resolve();
    handlers.get(type)?.({
      waitUntil: (promise: Promise<unknown>) => {
        done = promise;
      },
    });
    await done;
  }

  return { request, lifecycle, store, fetch };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('public/sw.js', () => {
  it('ships the version marker the deploy job replaces with the commit SHA', () => {
    expect(SOURCE).toContain("const VERSION = '__BUILD_SHA__';");
    expect(SOURCE).toContain("const CACHE_NAME = 'yekora-' + VERSION;");
  });

  // T1.1 · Interceptable ⟺ GET ∧ ¬API (and same origin, never sw.js or version.txt).
  it.each([
    ['POST', '/'],
    ['PUT', '/envios-y-devoluciones/'],
    ['DELETE', '/api/orders/1'],
    ['GET', '/api/products'],
    ['GET', '/sw.js'],
    ['GET', '/version.txt'],
    ['GET', 'https://cdn.example.com/x.png'],
  ])('lets %s %s go straight to the network', async (method, path) => {
    const worker = await loadWorker(online);
    expect(await worker.request(path, method)).toBeUndefined();
  });

  it('serves pages Network-First: the network wins and refreshes the copy', async () => {
    const worker = await loadWorker(online);
    await worker.lifecycle('install');
    worker.store
      .get(CACHE)!
      .set(`${ORIGIN}/privacidad/`, new Response('stale'));
    const response = await worker.request('/privacidad/');
    expect(await response!.text()).toBe('fresh /privacidad/');
    expect(
      await worker.store.get(CACHE)!.get(`${ORIGIN}/privacidad/`)!.text()
    ).toBe('fresh /privacidad/');
  });

  it('does not cache a failed page response', async () => {
    const worker = await loadWorker(
      async () => new Response('gone', { status: 404 })
    );
    const response = await worker.request('/no-existe/');
    expect(response!.status).toBe(404);
    expect(worker.store.get(CACHE)!.has(`${ORIGIN}/no-existe/`)).toBe(false);
  });

  it('falls back to the cached copy, then to the offline page of the visitor language', async () => {
    const worker = await loadWorker(offline);
    await worker.lifecycle('install');
    worker.store
      .get(CACHE)!
      .set(`${ORIGIN}/nosotros/`, new Response('visited'));
    expect(await (await worker.request('/nosotros/'))!.text()).toBe('visited');
    expect(await (await worker.request('/terminos/'))!.text()).toBe(
      OFFLINE_HTML['/offline/']
    );
    expect(await (await worker.request('/en/terms/'))!.text()).toBe(
      OFFLINE_HTML['/en/offline/']
    );
    expect(await (await worker.request('/en'))!.text()).toBe(
      OFFLINE_HTML['/en/offline/']
    );
  });

  it('returns a network error when neither the page nor the offline page is cached', async () => {
    const worker = await loadWorker(offline);
    const response = await worker.request('/terminos/');
    expect(response!.type).toBe('error');
  });

  it('serves immutable assets Cache-First', async () => {
    const worker = await loadWorker(online);
    const asset = '/_next/static/chunks/main-abc123.js';
    for (let visit = 0; visit < 2; visit += 1) {
      const response = await worker.request(asset, 'GET', 'no-cors');
      expect(await response!.text()).toBe(`fresh ${asset}`);
    }
    expect(worker.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed asset response', async () => {
    const worker = await loadWorker(
      async () => new Response('', { status: 500 })
    );
    await worker.request('/icons/icon-192.png', 'GET', 'no-cors');
    expect(worker.store.get(CACHE)!.has(`${ORIGIN}/icons/icon-192.png`)).toBe(
      false
    );
  });

  it('leaves other same-origin GETs (not pages, not assets) to the network', async () => {
    const worker = await loadWorker(online);
    expect(
      await worker.request('/robots.txt', 'GET', 'no-cors')
    ).toBeUndefined();
  });

  it('returns a network error for an asset that is neither cached nor reachable', async () => {
    const worker = await loadWorker(offline);
    const response = await worker.request(
      '/_next/static/chunks/x.js',
      'GET',
      'no-cors'
    );
    expect(response!.type).toBe('error');
  });

  it('precaches the offline pages with their scripts, styles and fonts, and the icons', async () => {
    const worker = await loadWorker(online);
    await worker.lifecycle('install');
    expect([...worker.store.get(CACHE)!.keys()]).toEqual(
      [
        '/offline/',
        '/en/offline/',
        '/favicon.ico',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
        '/_next/static/css/site.css',
        '/_next/static/chunks/offline-es.js',
        '/_next/static/media/inter.woff2',
        '/_next/static/chunks/offline-en.js',
      ].map((path) => `${ORIGIN}${path}`)
    );
  });

  // I-Cache-Purge · ∀ c ∈ Caches : c.name ≠ CurrentVersion ⇒ Deleted(c)
  it('deletes every cache of other versions on activate', async () => {
    const worker = await loadWorker(online);
    worker.store.set('yekora-old-sha', new Map());
    worker.store.set('something-else', new Map());
    worker.store.set(CACHE, new Map());
    await worker.lifecycle('activate');
    expect([...worker.store.keys()]).toEqual([CACHE]);
  });
});
