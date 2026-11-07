/**
 * The audit trail (FC 028 F1, T2.5): `audit_log` records what staff and admin do in the panel,
 * with who, from which address, and the state before and after as JSON.
 *
 * No personal business data enters it (T2.5b): every value under a key that names a password,
 * secret, token, code, name, e-mail, phone or address part is replaced before writing, and so is
 * any string with an `@`, wherever it appears (an e-mail under an innocent key). The client
 * address is technical
 * telemetry the FC allows (278_AN §2.4). Rows are never deleted by the API.
 * FC 029 T2.4 (319_AN, 320_AN): a catalog entry keeps `name` and `code` keys, which are public
 * catalog data; everything else stays redacted.
 *
 * @module
 */
import type { onResponseAsyncHookHandler } from 'fastify';
import type { Db, TxQuery } from './db';

/** What replaces a personal or secret value. */
const REDACTED = '[redacted]';

/** Keys whose values are personal data or secrets, in any naming style. */
const PII_KEY =
  /pass|secret|token|otp|backup|hash|code|name|mail|phone|address|street|exterior|interior|neighborhood|municipality|postal|zip/i;

/**
 * The same rule without `code` and `name` (FC 029 T2.4, 320_AN): a catalog diff keeps the public
 * names of products, brands and facets and their codes; secrets, e-mail, phone and address keys
 * and any string with an `@` stay redacted, as T2.5b demands.
 */
const CATALOG_PII_KEY =
  /pass|secret|token|otp|backup|hash|mail|phone|address|street|exterior|interior|neighborhood|municipality|postal|zip/i;

/** Entity types written by the catalog backoffice (routes/catalogMutation.ts and media). */
const CATALOG_ENTITIES = new Set([
  'media',
  'brands',
  'facet_groups',
  'facet_values',
  'products',
]);

/**
 * A copy of a value with every personal or secret part replaced by {@link REDACTED}.
 *
 * @param value - Any JSON-like value.
 * @param rule - Which keys are personal or secret.
 * @returns The same shape, safe for `audit_log`.
 */
function redactPii(value: unknown, rule: RegExp): unknown {
  if (typeof value === 'string') return value.includes('@') ? REDACTED : value;
  if (Array.isArray(value)) return value.map((item) => redactPii(item, rule));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        rule.test(key) ? REDACTED : redactPii(item, rule),
      ])
    );
  }
  return value;
}

/** One audit entry, before redaction. */
interface AuditEntry {
  /** The staff or admin user who acted. */
  userId: string;
  /** What was done, e.g. `GET /v1/admin/orders/:order_number`. */
  action: string;
  /** The kind of entity, e.g. `orders`. */
  entityType: string;
  /** Which one; `*` for a list. */
  entityId: string;
  /** State before the action, or null for a read. */
  before: unknown;
  /** State after the action, or what was asked for a read. */
  after: unknown;
  /** Client address. */
  ip: string | null;
}

/**
 * Writes one entry, redacted. FC 029 T2.4: a catalog mutation writes its entry inside its own
 * transaction, so the change and its trace commit or roll back together.
 *
 * @param db - Database port, or the transaction of the mutation.
 * @param entry - What happened.
 */
export async function recordAudit(
  db: TxQuery,
  entry: AuditEntry
): Promise<void> {
  const rule = CATALOG_ENTITIES.has(entry.entityType)
    ? CATALOG_PII_KEY
    : PII_KEY;
  const json = (state: unknown) =>
    state === null ? null : JSON.stringify(redactPii(state, rule));
  await db.query(
    'INSERT INTO audit_log (user_id, action, entity_type, entity_id, before_state, after_state, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      entry.userId,
      entry.action.slice(0, 100),
      entry.entityType.slice(0, 50),
      entry.entityId.slice(0, 100),
      json(entry.before),
      json(entry.after),
      entry.ip,
    ]
  );
}

/**
 * The audit interceptor: an `onResponse` hook that records every answered request a signed-in
 * user made under `/v1/admin` (T2.5a), after the answer has left, so the trail never slows the
 * panel. A failed write is logged, never shown to the client.
 *
 * @param db - Database port.
 * @returns The hook app.ts registers.
 */
export function auditTrail(db: Db): onResponseAsyncHookHandler {
  return async (request, reply) => {
    const route = request.routeOptions.url;
    if (request.user === null || !route?.startsWith('/v1/admin/')) return;
    const params = Object.values(request.params as Record<string, string>);
    try {
      await recordAudit(db, {
        userId: request.user.userId,
        action: `${request.method} ${route}`,
        entityType: route.split('/')[3],
        entityId: params[0] ?? '*',
        before: null,
        after: { query: request.query, status: reply.statusCode },
        ip: request.ip,
      });
    } catch (error) {
      request.log.error({ err: error }, 'audit_log write failed');
    }
  };
}
