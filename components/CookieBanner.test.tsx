// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  it('stays hidden when the notice was already read', () => {
    jar = `other=1; ${CONSENT_COOKIE}=1`;
    render(
      <CookieBanner locale="en" messages={getMessages('en').cookieBanner} />
    );
    expect(screen.queryByRole('region')).toBeNull();
  });
});
