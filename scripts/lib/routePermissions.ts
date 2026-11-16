/**
 * Route ↔ permission rule (FC 027 T2.6, S02; FC 028 T2.3): every route of the API contract names
 * exactly one permission, that permission exists in the RBAC catalog, and no route under the
 * private prefixes is public. scripts/checkApiContract.ts applies it to apps/api/src/contract.ts.
 *
 * FC 028 adds three letters:
 * - T2.3a: a `/v1/admin` route needs a granular permission, never the buyer's `account:self`.
 * - T2.3c: a `DELETE` route may only refuse (405); no master entity is ever deleted. FC 029
 *   T1.1: a guarded DELETE may also carry the guard's 401, 403 and 503, which come first.
 *   FC 051: the holder of an account may delete their own personal data (the right of
 *   cancellation, LFPDPPP), which is not a master entity: the routes of {@link OWN_DATA_DELETES},
 *   and only they, really delete, and only with the buyer's own permission.
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

/**
 * The only DELETE routes that do something (FC 051): a holder deleting a row of their own
 * personal data. Named one by one, never by pattern, so a new one is a decision of the contract.
 */
const OWN_DATA_DELETES: ReadonlySet<string> = new Set([
  'DELETE /v1/account/addresses/:id',
]);

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

/** What is wrong with a DELETE route, or null: it only refuses, or it is one of the holder's own. */
function deleteViolation(route: PermissionedRoute): string | null {
  const at = `${route.method} ${route.path}`;
  if (OWN_DATA_DELETES.has(at)) {
    return route.permission === SELF_PERMISSION
      ? null
      : "a delete of one's own data needs account:self";
  }
  return route.method === 'DELETE' && !refusesBehindGuard(route)
    ? 'DELETE must only refuse (405)'
    : null;
}

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
    const deleting = deleteViolation(route);
    if (deleting !== null) violations.push(`${at}: ${deleting}`);
  }
  return violations;
}
