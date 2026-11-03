/**
 * Q03 · API contract gate (FC 027 T2.2 and T2.6, ADR 0014).
 *   a) Builds the OpenAPI 3.1 document from the route registry (apps/api/src/contract.ts).
 *   b) Refuses any breaking change against the committed apps/api/openapi.json: a client in
 *      the field must keep working. A real break goes to a new major path, not to /v1.
 *   c) Refuses a committed document that is stale (a compatible change not written yet). The
 *      comparison is by content, so Prettier's layout of the JSON does not matter.
 *   d) Refuses a route without a known permission, or a private route declared public.
 * CLI: `bun scripts/checkApiContract.ts` — exit 0 = in sync · exit 1 = breaking, stale or unguarded.
 *      `bun scripts/checkApiContract.ts --write` — writes the document when the change is compatible.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { ROUTE_CONTRACTS } from '../apps/api/src/contract';
import { PERMISSIONS } from '../apps/api/src/lib/permissions';
import { problemSchema } from '../apps/api/src/lib/problem';
import {
  breakingChanges,
  buildOpenApi,
  type OpenApiDocument,
} from './lib/contractValidation';
import { routePermissionViolations } from './lib/routePermissions';

const DOCUMENT = 'apps/api/openapi.json';
/** RBAC permission codes (FC 028): the catalog migration 004 seeds, as the API names it. */
const PERMISSION_CATALOG: readonly string[] = PERMISSIONS;

const write = process.argv.includes('--write');
const next = buildOpenApi(ROUTE_CONTRACTS, problemSchema, {
  title: 'YĒKORA API',
  version: '1',
});
const text = `${JSON.stringify(next, null, 2)}\n`;
const failures = routePermissionViolations(
  ROUTE_CONTRACTS,
  PERMISSION_CATALOG
).map((violation) => `d) ${violation}`);

if (existsSync(DOCUMENT)) {
  const before = JSON.parse(readFileSync(DOCUMENT, 'utf8')) as OpenApiDocument;
  for (const change of breakingChanges(before, next))
    failures.push(`b) breaking: ${change}`);
  // Round-trip the new document through JSON so `undefined` fields compare as absent.
  if (failures.length === 0 && !isDeepStrictEqual(before, JSON.parse(text))) {
    if (write) writeFileSync(DOCUMENT, text);
    else
      failures.push(`c) ${DOCUMENT} is stale: run with --write and commit it`);
  }
} else if (write) {
  writeFileSync(DOCUMENT, text);
} else {
  failures.push(`a) ${DOCUMENT} is missing: run with --write and commit it`);
}

if (failures.length > 0) {
  console.error('[FAIL] Q03 API contract:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `[OK] Q03 API contract: ${ROUTE_CONTRACTS.length} routes, every one with a permission, OpenAPI 3.1 in sync, no breaking change.`
);
