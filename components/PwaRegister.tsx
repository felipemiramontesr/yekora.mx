'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker `/sw.js` (FC 007). Renders nothing.
 *
 * Only in production builds and browsers that support service workers. The dev server never
 * gets a worker, so it cannot be cached stale. Registration waits for the `load` event so it
 * never competes with the first render. A failed registration only costs the offline mode, so
 * it is reported in the console and the page keeps working.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
        console.warn('[pwa] service worker registration failed', error);
      });
    };
    if (document.readyState === 'complete') {
      register();
      return;
    }
    globalThis.addEventListener('load', register, { once: true });
    return () => globalThis.removeEventListener('load', register);
  }, []);
  return null;
}
