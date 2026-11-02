/**
 * Route ↔ permission rule (FC 027 T2.6, S02): every route of the API contract names exactly one
 * permission, that permission exists in the RBAC catalog, and no route under the private
 * prefixes is public. scripts/checkApiContract.ts applies it to apps/api/src/contract.ts.
 *
 * Today every route is public and the catalog is empty, so the private-prefix rule has no route
 * to judge yet; it binds from the first `/v1/account` or `/v1/admin` route of FC 028 on.
 *
 * @module
 */

/** Permission of a route anyone may call. */
export const PUBLIC_PERMISSION = 'public';

/** Prefixes whose routes always need a session and a permission (FC 028). */
export const PRIVATE_PREFIXES = ['/v1/account', '/v1/admin'] as const;

/** The part of a route contract the rule reads. */
export interface PermissionedRoute {
  method: string;
  path: string;
  permission: string;
}

/**
 * Finds every route that breaks the route ↔ permission rule.
 *
 * @param routes - The API contract.
 * @param catalog - Permission codes of the RBAC catalog (empty until FC 028).
 * @returns One message per violation; empty when the mapping is complete.
 */
export function routePermissionViolations(
  routes: readonly PermissionedRoute[],
  catalog: readonly string[]
): string[] {
  const violations: string[] = [];
  const known = new Set([PUBLIC_PERMISSION, ...catalog]);
  const seen = new Set<string>();
  for (const { method, path, permission } of routes) {
    const route = `${method} ${path}`;
    if (seen.has(route)) violations.push(`${route}: declared twice`);
    seen.add(route);
    if (!known.has(permission))
      violations.push(`${route}: unknown permission "${permission}"`);
    const isPrivate = PRIVATE_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`)
    );
    if (isPrivate && permission === PUBLIC_PERMISSION)
      violations.push(`${route}: private route declared public`);
  }
  return violations;
}
