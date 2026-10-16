import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { LOCALE_COOKIE, config, middleware } from './middleware';

function request(
  path: string,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest(new URL(path, 'https://yekora.mx'), { headers });
}

describe('locale middleware', () => {
  it('redirects the root to es-MX by default', () => {
    const response = middleware(request('/'));
    expect(response.headers.get('location')).toBe('https://yekora.mx/es-MX');
  });

  it('keeps the path and query when adding the locale', () => {
    const response = middleware(request('/nosotros?x=1'));
    expect(response.headers.get('location')).toBe(
      'https://yekora.mx/es-MX/nosotros?x=1'
    );
  });

  it('follows the browser language when it prefers English', () => {
    const response = middleware(
      request('/', { 'accept-language': 'en-US,en;q=0.9' })
    );
    expect(response.headers.get('location')).toBe('https://yekora.mx/en');
  });

  it('uses es-MX when the browser prefers another language', () => {
    const response = middleware(
      request('/', { 'accept-language': 'fr-FR,fr;q=0.9' })
    );
    expect(response.headers.get('location')).toBe('https://yekora.mx/es-MX');
  });

  it('prefers the saved locale cookie over the browser language', () => {
    const response = middleware(
      request('/', {
        cookie: `${LOCALE_COOKIE}=en`,
        'accept-language': 'es-MX',
      })
    );
    expect(response.headers.get('location')).toBe('https://yekora.mx/en');
  });

  it('ignores an unknown locale cookie', () => {
    const response = middleware(
      request('/', { cookie: `${LOCALE_COOKIE}=fr` })
    );
    expect(response.headers.get('location')).toBe('https://yekora.mx/es-MX');
  });

  it('lets localized paths through and remembers the locale', () => {
    const response = middleware(request('/en/nosotros'));
    expect(response.headers.get('location')).toBeNull();
    const cookie = response.cookies.get(LOCALE_COOKIE);
    expect(cookie?.value).toBe('en');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
  });

  it('does not rewrite the cookie when it already matches', () => {
    const response = middleware(
      request('/es-MX', { cookie: `${LOCALE_COOKIE}=es-MX` })
    );
    expect(response.cookies.get(LOCALE_COOKIE)).toBeUndefined();
  });

  it('marks the cookie as not secure over plain http', () => {
    const response = middleware(new NextRequest('http://localhost:3000/en'));
    expect(response.cookies.get(LOCALE_COOKIE)?.secure).toBe(false);
  });

  it('only matches page paths', () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test('/en/nosotros')).toBe(true);
    expect(matcher.test('/_next/static/chunk.js')).toBe(false);
    expect(matcher.test('/brand/YEKORA_isotipo_vectorial.svg')).toBe(false);
  });
});
