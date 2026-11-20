// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/app/i18n';
import { CookieBanner } from './CookieBanner';

const CONSENT_COOKIE = 'yekora_cookie_consent';

// Controlled cookie jar: records exactly what the banner writes.
let jar = '';
const written: string[] = [];

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    }
  );
  jar = '';
  written.length = 0;
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => jar,
    set: (value: string) => {
      written.push(value);
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CookieBanner', () => {
  it('shows the technical-cookie notice until it is acknowledged', () => {
    render(
      <CookieBanner
        locale="es-MX"
        messages={getMessages('es-MX').cookieBanner}
      />
    );
    const banner = screen.getByRole('region', { name: 'Aviso de cookies' });
    expect(banner.textContent).toContain('dos cookies técnicas propias');
    expect(
      screen
        .getByRole('link', { name: 'Ver política de cookies' })
        .getAttribute('href')
    ).toBe('/cookies/');

    fireEvent.click(screen.getByRole('button', { name: 'Solo lo necesario' }));

    expect(screen.queryByRole('region')).toBeNull();
    expect(written).toEqual([
      `${CONSENT_COOKIE}=1; Max-Age=31536000; Path=/; SameSite=Lax`,
    ]);
  });

  it('keeps the height of the notice as space at the end of the page while it is open, and gives it back (FC 055 T2.8)', () => {
    let reserve: () => void = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          reserve = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      }
    );
    const height = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockReturnValue(180);
    const root = document.documentElement;
    render(
      <CookieBanner locale="en" messages={getMessages('en').cookieBanner} />
    );
    expect(root.style.getPropertyValue('--cookie-banner-height')).toBe('180px');
    height.mockReturnValue(240);
    reserve();
    expect(root.style.getPropertyValue('--cookie-banner-height')).toBe('240px');

    fireEvent.click(
      screen.getByRole('button', { name: 'Only what is needed' })
    );
    expect(disconnect).toHaveBeenCalled();
    expect(root.style.getPropertyValue('--cookie-banner-height')).toBe('');
    height.mockRestore();
  });

  it('records the «yes» to the location, then closes the notice and tells the page (FC 055 T2.8)', () => {
    const heard = vi.fn();
    globalThis.addEventListener('yekora:location-consent', heard);
    render(
      <CookieBanner
        locale="es-MX"
        messages={getMessages('es-MX').cookieBanner}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Permitir ubicación' }));

    expect(screen.queryByRole('region')).toBeNull();
    expect(written).toEqual([
      'yekora_location_consent=1; Max-Age=31536000; Path=/; SameSite=Lax',
      `${CONSENT_COOKIE}=1; Max-Age=31536000; Path=/; SameSite=Lax`,
    ]);
    expect(heard).toHaveBeenCalledOnce();
    globalThis.removeEventListener('yekora:location-consent', heard);
  });

  it('never records the location when the visitor keeps only what is needed (FC 055 T2.8)', () => {
    render(
      <CookieBanner locale="en" messages={getMessages('en').cookieBanner} />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Only what is needed' })
    );
    expect(written.join(';')).not.toContain('location');
  });

  it('marks the cookie Secure over https', () => {
    vi.stubGlobal('location', { ...globalThis.location, protocol: 'https:' });
    render(
      <CookieBanner locale="en" messages={getMessages('en').cookieBanner} />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Only what is needed' })
    );
    expect(written[0]).toMatch(/; Secure$/);
  });

  it('is in the static HTML, hidden, with a disabled button until hydration (FC 043)', () => {
    const html = renderToStaticMarkup(
      <CookieBanner
        locale="es-MX"
        messages={getMessages('es-MX').cookieBanner}
      />
    );
    expect(html).toMatch(/<section aria-label="Aviso de cookies" hidden=""/);
    expect(html).toMatch(/<button type="button" disabled=""/);
    expect(html).toContain('dos cookies técnicas propias');
  });

  it.each([
    [
      'reveals it before the first paint when the cookie is missing',
      'other=1',
      false,
    ],
    [
      'keeps it hidden when the notice was read',
      `other=1; ${CONSENT_COOKIE}=1`,
      true,
    ],
    [
      'does not take a longer cookie name for it',
      `x${CONSENT_COOKIE}=1`,
      false,
    ],
  ])('its inline script %s (FC 043 T2.1)', (_case, cookies, hidden) => {
    jar = cookies;
    document.body.innerHTML = renderToStaticMarkup(
      <CookieBanner locale="en" messages={getMessages('en').cookieBanner} />
    );
    // innerHTML never runs a script: put the same text back as a fresh element, which jsdom runs
    // on insertion, with currentScript set, right after its banner, as the parser would.
    const parsed = document.body.querySelector('script');
    const script = document.createElement('script');
    script.textContent = parsed?.textContent ?? '';
    parsed?.replaceWith(script);
    expect(document.body.querySelector('section')?.hidden).toBe(hidden);
    document.body.innerHTML = '';
  });

  it('stays hidden when the notice was already read', () => {
    jar = `other=1; ${CONSENT_COOKIE}=1`;
    render(
      <CookieBanner locale="en" messages={getMessages('en').cookieBanner} />
    );
    expect(screen.queryByRole('region')).toBeNull();
  });
});
