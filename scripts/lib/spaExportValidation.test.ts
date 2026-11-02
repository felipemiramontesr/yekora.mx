import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  sessionCookieViolations,
  spaFallbackViolations,
  staticExportViolations,
} from './spaExportValidation';

describe('staticExportViolations (FC 027 T2.4, ADR 0011 §1)', () => {
  it('the real next.config.ts builds a static export', () => {
    expect(
      staticExportViolations(readFileSync('next.config.ts', 'utf8'))
    ).toEqual([]);
  });

  it('refuses a configuration with a server runtime', () => {
    expect(
      staticExportViolations("const c = { output: 'standalone' };")
    ).toEqual(["next.config.ts does not set output: 'export'"]);
  });
});

describe('spaFallbackViolations (ADR 0011 §1)', () => {
  const htaccess = [
    'RewriteEngine On',
    'RewriteCond %{REQUEST_FILENAME} !-f',
    'RewriteRule ^cuenta/ /cuenta/index.html [L]',
    '# RewriteRule ^admin/ /admin/index.html [L]',
  ].join('\n');

  it('accepts an area that rewrites to its own index.html', () => {
    expect(spaFallbackViolations(htaccess, ['cuenta'])).toEqual([]);
  });

  it('refuses an area without a rule, or whose rule is commented out', () => {
    expect(spaFallbackViolations(htaccess, ['admin', 'en/cuenta'])).toEqual([
      '.htaccess has no fallback from /admin/* to /admin/index.html',
      '.htaccess has no fallback from /en/cuenta/* to /en/cuenta/index.html',
    ]);
  });

  it('refuses a fallback to the root index.html, which is the home page', () => {
    expect(
      spaFallbackViolations('RewriteRule ^cuenta/ /index.html [L]', ['cuenta'])
    ).toHaveLength(1);
  });

  it('has nothing to judge while the site has no SPA area', () => {
    expect(
      spaFallbackViolations(readFileSync('public/.htaccess', 'utf8'), [])
    ).toEqual([]);
  });
});

describe('sessionCookieViolations (ADR 0011 §3)', () => {
  it('accepts HttpOnly, Secure and SameSite=Strict in any case and order', () => {
    expect(
      sessionCookieViolations(
        '__Host-sid=abc; Path=/; SameSite=Strict; Secure; HttpOnly'
      )
    ).toEqual([]);
  });

  it('names every missing flag, and does not read the value as a flag', () => {
    expect(sessionCookieViolations('sid=secure; Path=/; SameSite=Lax')).toEqual(
      [
        'session cookie lacks httponly',
        'session cookie lacks secure',
        'session cookie lacks samesite=strict',
      ]
    );
  });
});
