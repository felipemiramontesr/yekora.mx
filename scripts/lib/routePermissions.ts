/**
 * Route ↔ permission rule (FC 027 T2.6, S02; FC 028 T2.3): every route of the API contract names
 * exactly one permission, that permission exists in the RBAC catalog, and no route under the
 * private prefixes is public. scripts/checkApiContract.ts applies it to apps/api/src/contract.ts.
 *
 * FC 028 adds three letters:
 * - T2.3a: a `/v1/admin` route needs a granular permission, never the buyer's `account:self`.
 * - T2.3c: a `DELETE` route may only refuse (405); no master entity is ever deleted. FC 029
 *   T1.1: a guarded DELETE may also carry the guard's 401, 403 and 503, which come first.
 * - T2.6a: the one public route a private prefix may hold is a 405 refusal, which answers
 *   nothing else and reveals nothing.
 *
 * @module
 */

/** Permission of a route anyone may call. */
export const PUBLIC_PERMISSION = 'public';

/** Prefixes whose routes always need a session and a permission (FC 028). */
export const PRIVATE_PREFIXES = ['/v1/account', '/v1/admin'] as const;

/** The buyer's own permission, too broad for the panel (T2.3a). */
const SELF_PERMISSION = 'account:self';

/** The part of a route contract the rule reads. */
export interface PermissionedRoute {
  method: string;
  path: string;
  permission: string;
  /** Answers by status; a route whose only answer is 405 is a refusal. */
  responses?: Readonly<Record<number, unknown>>;
}

const under = (path: string, prefix: string) =>
  path === prefix || path.startsWith(`${prefix}/`);

/** Whether a route only ever answers 405 Method Not Allowed. */
const onlyRefuses = (route: PermissionedRoute) =>
  Object.keys(route.responses ?? {}).join() === '405';

/** What the session guard may answer before a guarded route runs (lib/guard.ts). */
const GUARD_REFUSALS = new Set(['401', '403', '503']);

/**
 * Whether a route answers 405 and nothing else of its own: the guard's refusals may come first
 * (FC 029 T1.1: a catalog DELETE without `catalog:write` is CAT_FORBIDDEN before the 405).
 */
const refusesBehindGuard = (route: PermissionedRoute) => {
  const statuses = Object.keys(route.responses ?? {});
  return (
    statuses.includes('405') &&
    statuses.every((status) => status === '405' || GUARD_REFUSALS.has(status))
  );
};

/**
 * Finds every route that breaks the route ↔ permission rule.
 *
 * @param routes - The API contract.
 * @param catalog - Permission codes of the RBAC catalog.
 * @returns One message per violation; empty when the mapping is complete.
 */
export function routePermissionViolations(
  routes: readonly PermissionedRoute[],
  catalog: readonly string[]
): string[] {
  const violations: string[] = [];
  const known = new Set([PUBLIC_PERMISSION, ...catalog]);
  const seen = new Set<string>();
  for (const route of routes) {
    const { method, path, permission } = route;
    const at = `${method} ${path}`;
    if (seen.has(at)) violations.push(`${at}: declared twice`);
    seen.add(at);
    if (!known.has(permission))
      violations.push(`${at}: unknown permission "${permission}"`);
    const isPrivate = PRIVATE_PREFIXES.some((prefix) => under(path, prefix));
    if (isPrivate && permission === PUBLIC_PERMISSION && !onlyRefuses(route))
      violations.push(`${at}: private route declared public`);
    if (under(path, '/v1/admin') && permission === SELF_PERMISSION)
      violations.push(`${at}: panel route without a granular permission`);
    if (method === 'DELETE' && !refusesBehindGuard(route))
      violations.push(`${at}: DELETE must only refuse (405)`);
  }
  return violations;
}
