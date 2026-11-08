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
    expect(banner.textContent).toContain('solo usa una cookie técnica');
    expect(
      screen
        .getByRole('link', { name: 'Ver política de cookies' })
        .getAttribute('href')
    ).toBe('/cookies/');

    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }));

    expect(screen.queryByRole('region')).toBeNull();
    expect(written).toEqual([
      `${CONSENT_COOKIE}=1; Max-Age=31536000; Path=/; SameSite=Lax`,
    ]);
  });

  it('marks the cookie Secure over https', () => {
    vi.stubGlobal('location', { ...globalThis.location, protocol: 'https:' });
    render(
      <CookieBanner locale="en" messages={getMessages('en').cookieBanner} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
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
    expect(html).toContain('solo usa una cookie técnica');
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
