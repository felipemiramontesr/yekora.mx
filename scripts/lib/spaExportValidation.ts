/**
 * Rules of ADR 0011 (FC 027 T2.4): the site stays a static export, every SPA area has its
 * Apache fallback, and every session cookie the API sets is HttpOnly, Secure and SameSite=Strict.
 *
 * The fallback of an SPA area points to that area's own index.html (`/cuenta/index.html`), never
 * the root one: with `trailingSlash` every page is a folder, and the root index.html is the home.
 * scripts/checkPlatformGuards.ts applies the first two rules to next.config.ts and
 * public/.htaccess; the cookie rule binds the sign-in routes of FC 028.
 *
 * @module
 */

import {
  ACCOUNT_SEGMENTS,
  type AccountView,
  accountPath,
  CATALOG_SECTIONS,
} from '../../lib/account/accountPaths';

/**
 * Areas of the site that are client-rendered behind a session (FC 028 onward): the Spanish
 * folder and its English slug (`/cuenta/` and `/en/account/`).
 */
export const SPA_AREAS = [
  { es: 'cuenta', en: 'account' },
  { es: 'admin', en: 'admin' },
] as const;

/**
 * Checks that Next.js builds a static export, with no server runtime.
 *
 * @param nextConfig - Text of next.config.ts.
 * @returns One message per broken rule.
 */
export function staticExportViolations(nextConfig: string): string[] {
  return /\boutput:\s*['"]export['"]/.test(nextConfig)
    ? []
    : ["next.config.ts does not set output: 'export'"];
}

/**
 * Checks that each SPA area has an Apache rewrite to its own index.html.
 *
 * @param htaccess - Text of public/.htaccess.
 * @param areas - SPA areas the site has, as URL paths without slashes (`cuenta`, `en/cuenta`).
 * @returns One message per area without its fallback.
 */
export function spaFallbackViolations(
  htaccess: string,
  areas: readonly string[]
): string[] {
  const rules = htaccess
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('RewriteRule '));
  return areas
    .filter(
      (area) =>
        !rules.some(
          (rule) =>
            rule.includes(`^${area}/`) && rule.includes(` /${area}/index.html`)
        )
    )
    .map(
      (area) =>
        `.htaccess has no fallback from /${area}/* to /${area}/index.html`
    );
}

/** An order number the guard writes into the paths it tries (the shape of a real one). */
const SAMPLE_ORDER = 'YEK-2026-AB12CD34';

/** Addresses of the account area that must answer a real 404: the retired one, an unknown one, an extra segment. */
const UNKNOWN_PATHS = ['administradores/', 'no-existe/', 'datos/x/'] as const;

/**
 * The addresses of an account area the page opens, relative to the area, as Apache sees them:
 * every tab with a fixed segment, each tab of the catalog, and an order of the buyer and of the
 * panel. The root of the area is left out: it is the file `index.html`, not a rewrite.
 *
 * @param area - The area as a URL path without slashes (`cuenta`, `en/account`).
 * @returns The paths, with no leading slash.
 */
function openedPaths(area: string): string[] {
  const root = `/${area}/`;
  const tabs = Object.keys(
    ACCOUNT_SEGMENTS
  ) as (keyof typeof ACCOUNT_SEGMENTS)[];
  const views: AccountView[] = [
    ...tabs.map((tab) => ({ tab, orderNumber: null })),
    ...CATALOG_SECTIONS.map((section) => ({
      tab: 'catalog' as const,
      orderNumber: null,
      section,
    })),
    { tab: 'panel', orderNumber: SAMPLE_ORDER },
    { tab: 'orders', orderNumber: SAMPLE_ORDER },
  ];
  return views.map((view) => accountPath(root, view).slice(1));
}

/**
 * Checks the whitelist of the account area in public/.htaccess (FC 074, K-77): the root is
 * served as a file by `DirectoryIndex index.html`; every address the page opens is rewritten to
 * the area's own index.html; and no other address is, so an unknown or retired one (the old
 * `administradores/`) answers a real 404 and never a 200 with the page. A catch-all rewrite is
 * refused.
 *
 * @param htaccess - Text of public/.htaccess.
 * @param areas - The account areas as URL paths without slashes (`cuenta`, `en/account`).
 * @returns One message per broken rule.
 */
export function accountWhitelistViolations(
  htaccess: string,
  areas: readonly string[]
): string[] {
  const lines = htaccess.split(/\r?\n/).map((line) => line.trim());
  const messages = lines.some((line) =>
    /^DirectoryIndex\s+index\.html$/.test(line)
  )
    ? []
    : [
        '.htaccess has no `DirectoryIndex index.html`: the root of an account area would not be served',
      ];
  for (const area of areas) {
    const patterns = lines
      .filter((line) => line.startsWith(`RewriteRule ^${area}/`))
      .filter((line) => line.endsWith(` /${area}/index.html [L]`))
      .map((line) => line.split(/\s+/)[1]);
    for (const pattern of patterns.filter((rule) =>
      /\/(?:\.|\.\*|\.\+)$/.test(rule)
    )) {
      messages.push(
        `.htaccess rewrites every address under /${area}/ to its index.html (${pattern}): an unknown one would answer 200`
      );
    }
    const admits = (path: string) =>
      patterns.some((pattern) => new RegExp(pattern).test(path));
    for (const path of openedPaths(area).filter((path) => !admits(path))) {
      messages.push(
        `.htaccess does not admit /${path}, an address of accountPaths.ts`
      );
    }
    for (const path of UNKNOWN_PATHS.map((rest) => `${area}/${rest}`).filter(
      admits
    )) {
      messages.push(`.htaccess admits /${path}, which must answer a real 404`);
    }
  }
  return messages;
}

/**
 * Checks one `Set-Cookie` header of a session against ADR 0011 §3.
 *
 * @param setCookie - The header value.
 * @returns One message per missing attribute.
 */
export function sessionCookieViolations(setCookie: string): string[] {
  const attributes = setCookie
    .split(';')
    .slice(1)
    .map((part) => part.trim().toLowerCase());
  const required = ['httponly', 'secure', 'samesite=strict'];
  return required
    .filter((attribute) => !attributes.includes(attribute))
    .map((attribute) => `session cookie lacks ${attribute}`);
}
