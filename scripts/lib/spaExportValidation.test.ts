import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  accountWhitelistViolations,
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

describe('accountWhitelistViolations (FC 074 K-77, T0.1, T2.1, T2.2, T2.4)', () => {
  const real = readFileSync('public/.htaccess', 'utf8');
  const AREAS = ['cuenta', 'en/account'];
  const ruleOf = (area: string, pattern: string) =>
    `RewriteRule ^${area}/${pattern} /${area}/index.html [L]`;

  it('accepts the real .htaccess, whose whitelist is the one of accountPaths.ts', () => {
    expect(accountWhitelistViolations(real, AREAS)).toEqual([]);
  });

  it('refuses a catch-all rewrite, which would answer 200 to any address', () => {
    for (const wildcard of ['.', '.*', '.+']) {
      const text = [
        'DirectoryIndex index.html',
        ruleOf('cuenta', wildcard),
      ].join('\n');
      const found = accountWhitelistViolations(text, ['cuenta']);
      expect(found.some((m) => m.includes('every address'))).toBe(true);
      expect(found.some((m) => m.includes('/cuenta/administradores/'))).toBe(
        true
      );
    }
  });

  it('refuses an area that leaves out an address the page opens, naming it', () => {
    const text = real.replaceAll('|devoluciones', '');
    expect(accountWhitelistViolations(text, AREAS)).toEqual([
      '.htaccess does not admit /cuenta/devoluciones/, an address of accountPaths.ts',
      '.htaccess does not admit /en/account/devoluciones/, an address of accountPaths.ts',
    ]);
  });

  it('refuses a whitelist that admits the retired address, an unknown one or an extra segment', () => {
    const text = [
      'DirectoryIndex index.html',
      ruleOf('cuenta', '(?:datos|administradores)(?:/x)?/?$'),
    ].join('\n');
    const found = accountWhitelistViolations(text, ['cuenta']);
    expect(found).toContain(
      '.htaccess admits /cuenta/administradores/, which must answer a real 404'
    );
    expect(found).toContain(
      '.htaccess admits /cuenta/datos/x/, which must answer a real 404'
    );
  });

  it('asks for DirectoryIndex index.html, which is what serves the root of the area as a file', () => {
    const text = real.replace('DirectoryIndex index.html', '');
    expect(accountWhitelistViolations(text, AREAS)).toEqual([
      '.htaccess has no `DirectoryIndex index.html`: the root of an account area would not be served',
    ]);
  });

  it('does not ask the root of the area to be a rewrite: putting it in the rule is no error', () => {
    const text = real.replaceAll('(?:datos|', '(?:|datos|');
    expect(accountWhitelistViolations(text, AREAS)).toEqual([]);
  });

  it('has nothing to judge about an area without rules except its missing paths', () => {
    expect(
      accountWhitelistViolations('DirectoryIndex index.html', ['cuenta']).length
    ).toBeGreaterThan(0);
    expect(accountWhitelistViolations('DirectoryIndex index.html', [])).toEqual(
      []
    );
  });
});
