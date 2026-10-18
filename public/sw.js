/**
 * YĒKORA service worker (FC 007).
 *
 * Versioning: VERSION is the marker __BUILD_SHA__ in the repository. The deploy job replaces it
 * with the commit SHA in out/sw.js, so every deploy ships different bytes, the browser installs
 * the new worker, and `activate` deletes every cache of older versions (I-Cache-Purge). The
 * post-deploy smoke test fails if production still serves the marker.
 *
 * Interception (truth table T1.1, Interceptable ⟺ GET ∧ ¬API):
 * - only same-origin GET requests, never /api/*, never sw.js or version.txt;
 * - HTML: Network-First. The network always wins, so legal texts and future prices are never
 *   stale. The cached copy is a fallback only, then the offline page of the visitor's language,
 *   precached together with its scripts, styles and fonts so it renders complete offline;
 * - immutable assets (/_next/static/*, icons, images, fonts): Cache-First;
 * - anything else goes straight to the network.
 */
const VERSION = '__BUILD_SHA__';
const CACHE_NAME = 'yekora-' + VERSION;
const OFFLINE_PAGES = { es: '/offline/', en: '/en/offline/' };
const PRECACHE = [
  OFFLINE_PAGES.es,
  OFFLINE_PAGES.en,
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];
const NEVER_CACHED = new Set(['/sw.js', '/version.txt']);
const STATIC_ASSET = /^\/_next\/static\/|\.(?:png|svg|ico|woff2?|webp|jpg)$/;
// Script, style and font URLs an exported page references (src="…" or href="…").
const PAGE_ASSET = /(?:src|href)="(\/_next\/static\/[^"]+)"/g;

/**
 * Precaches the offline pages and everything they load (JS, CSS, fonts). Offline, a missing
 * chunk makes Next.js reload the page, which then fails; so the fallback must be complete.
 */
async function precache(cache) {
  await cache.addAll(PRECACHE);
  const assets = new Set();
  for (const page of Object.values(OFFLINE_PAGES)) {
    const html = await (await cache.match(page)).text();
    for (const [, asset] of html.matchAll(PAGE_ASSET)) assets.add(asset);
  }
  await cache.addAll([...assets]);
}

/** Whether the worker may handle a request at all (T1.1). */
function interceptable(request, url) {
  return (
    request.method === 'GET' &&
    url.origin === self.location.origin &&
    !url.pathname.startsWith('/api/') &&
    !NEVER_CACHED.has(url.pathname)
  );
}

/** Offline page in the language of the requested path. */
function offlinePageFor(pathname) {
  return pathname === '/en' || pathname.startsWith('/en/')
    ? OFFLINE_PAGES.en
    : OFFLINE_PAGES.es;
}

async function networkFirst(request, url) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (
      (await cache.match(request)) ??
      (await cache.match(offlinePageFor(url.pathname))) ??
      Response.error()
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(precache)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (!interceptable(request, url)) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, url));
  } else if (STATIC_ASSET.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});
