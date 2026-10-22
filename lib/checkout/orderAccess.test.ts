// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recallOrder, rememberOrder } from './orderAccess';

const ACCESS = {
  orderNumber: 'YEK-2026-AB12CD34',
  accessToken: 'a'.repeat(43),
  redirectUrl: 'https://checkout.stripe.com/c/pay/x',
};

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('order access in session storage', () => {
  it('round-trips the last order of this tab, never in local storage', () => {
    expect(rememberOrder(ACCESS)).toBe(true);
    expect(recallOrder()).toEqual(ACCESS);
    expect(sessionStorage.getItem('yekora_order_access_v1')).toBe(
      JSON.stringify(ACCESS)
    );
    expect(localStorage).toHaveLength(0);
  });

  it('keeps only the newest order', () => {
    rememberOrder(ACCESS);
    const next = { ...ACCESS, orderNumber: 'YEK-2026-ZZZZ9999' };
    rememberOrder(next);
    expect(recallOrder()).toEqual(next);
  });

  it('finds nothing when nothing was stored', () => {
    expect(recallOrder()).toBeNull();
  });

  it.each([
    ['not JSON', '{'],
    ['null', 'null'],
    [
      'a malformed order number',
      JSON.stringify({ ...ACCESS, orderNumber: 'YEK-1' }),
    ],
    ['a short token', JSON.stringify({ ...ACCESS, accessToken: 'abc' })],
    ['a missing token', JSON.stringify({ ...ACCESS, accessToken: undefined })],
    ['a numeric order number', JSON.stringify({ ...ACCESS, orderNumber: 7 })],
    ['no payment page', JSON.stringify({ ...ACCESS, redirectUrl: null })],
  ])('ignores a stored value with %s', (_case, raw) => {
    sessionStorage.setItem('yekora_order_access_v1', raw);
    expect(recallOrder()).toBeNull();
  });

  it('reports a store the browser refuses, and reads nothing from it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(rememberOrder(ACCESS)).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(recallOrder()).toBeNull();
  });

  it('without storage (blocked or prerendering) remembers nothing', () => {
    expect(rememberOrder(ACCESS, null)).toBe(false);
    expect(recallOrder(null)).toBeNull();
  });

  it('has no storage while prerendering (no window)', () => {
    vi.stubGlobal('window', undefined);
    expect(recallOrder()).toBeNull();
    vi.unstubAllGlobals();
  });

  it('treats a browser that blocks session storage as no storage', () => {
    vi.spyOn(globalThis.window, 'sessionStorage', 'get').mockImplementation(
      () => {
        throw new Error('SecurityError');
      }
    );
    expect(rememberOrder(ACCESS)).toBe(false);
  });
});
