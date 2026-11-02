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

/** Areas of the site that are client-rendered behind a session (FC 028 onward). */
export const SPA_AREAS = ['cuenta', 'admin'] as const;

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
