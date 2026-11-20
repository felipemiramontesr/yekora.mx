// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  grantLocationConsent,
  hasLocationConsent,
  subscribeLocationConsent,
} from './locationConsent';

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = `yekora_location_consent=; Max-Age=0; Path=/`;
});

describe('location consent (FC 055 T2.8)', () => {
  it.each([
    ['', false],
    ['other=1', false],
    [`yekora_location_consent=1`, true],
    [`other=1; yekora_location_consent=1`, true],
    [`xyekora_location_consent=1`, false],
    [`yekora_location_consent=0`, false],
  ])('reads %j as %j', (cookies, expected) => {
    expect(hasLocationConsent(cookies)).toBe(expected);
  });

  it('reads the cookie of the document when none is given', () => {
    expect(hasLocationConsent()).toBe(false);
    document.cookie = `yekora_location_consent=1; Path=/`;
    expect(hasLocationConsent()).toBe(true);
  });

  it('records the yes for a year and tells whoever listens, until they stop', () => {
    const heard = vi.fn();
    const stop = subscribeLocationConsent(heard);
    grantLocationConsent();
    expect(hasLocationConsent()).toBe(true);
    expect(heard).toHaveBeenCalledOnce();
    stop();
    grantLocationConsent();
    expect(heard).toHaveBeenCalledOnce();
  });

  it('marks the cookie Secure over https', () => {
    const written: string[] = [];
    vi.stubGlobal('location', { protocol: 'https:' });
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '',
      set: (value: string) => written.push(value),
    });
    grantLocationConsent();
    expect(written[0]).toBe(
      `yekora_location_consent=1; Max-Age=31536000; Path=/; SameSite=Lax; Secure`
    );
    // Remove the shadowing property so the real jar is back for the next test.
    Reflect.deleteProperty(document, 'cookie');
  });

  it('reads as no consent when there is no document, as on the server', () => {
    vi.stubGlobal('document', undefined);
    expect(hasLocationConsent()).toBe(false);
  });
});
