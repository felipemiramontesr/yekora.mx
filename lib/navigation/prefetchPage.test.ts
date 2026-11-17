// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prefetchPage } from './prefetchPage';

const links = () => document.head.querySelectorAll('link[rel="prefetch"]');
const rules = () =>
  document.head.querySelectorAll('script[type="speculationrules"]');

beforeEach(() => {
  document.head.innerHTML = '';
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('prefetchPage (FC 053 T1.2)', () => {
  it('adds a prefetch link for the page, once, and no rules where the browser lacks them', () => {
    prefetchPage('/en/account/');
    prefetchPage('/en/account/');
    expect(links()).toHaveLength(1);
    expect(links()[0]?.getAttribute('href')).toBe('/en/account/');
    expect(rules()).toHaveLength(0);
  });

  it('also prerenders where speculation rules are supported', () => {
    vi.stubGlobal('HTMLScriptElement', {
      supports: (type: string) => type === 'speculationrules',
    });
    prefetchPage('/cuenta/');
    expect(JSON.parse(rules()[0]?.textContent ?? '{}')).toEqual({
      prerender: [{ source: 'list', urls: ['/cuenta/'] }],
    });
  });

  it('never throws, even when the document refuses', () => {
    vi.spyOn(document, 'createElement').mockImplementation(() => {
      throw new Error('refused');
    });
    expect(() => prefetchPage('/x/')).not.toThrow();
  });
});
