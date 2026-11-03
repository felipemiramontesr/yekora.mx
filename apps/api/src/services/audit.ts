/**
 * The audit trail (FC 028 F1, T2.5): `audit_log` records what staff and admin do in the panel,
 * with who, from which address, and the state before and after as JSON.
 *
 * No personal business data enters it (T2.5b): every value under a key that names a password,
 * secret, token, code, name, e-mail, phone or address part is replaced before writing, and so is
 * any string with an `@`, wherever it appears (an e-mail under an innocent key). The client
 * address is technical
 * telemetry the FC allows (278_AN §2.4). Rows are never deleted by the API.
 *
 * @module
 */
import type { onResponseAsyncHookHandler } from 'fastify';
import type { Db } from './db';

/** What replaces a personal or secret value. */
const REDACTED = '[redacted]';

/** Keys whose values are personal data or secrets, in any naming style. */
const PII_KEY =
  /pass|secret|token|otp|backup|hash|code|name|mail|phone|address|street|exterior|interior|neighborhood|municipality|postal|zip/i;

/**
 * A copy of a value with every personal or secret part replaced by {@link REDACTED}.
 *
 * @param value - Any JSON-like value.
 * @returns The same shape, safe for `audit_log`.
 */
function redactPii(value: unknown): unknown {
  if (typeof value === 'string') return value.includes('@') ? REDACTED : value;
  if (Array.isArray(value)) return value.map(redactPii);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        PII_KEY.test(key) ? REDACTED : redactPii(item),
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
 * Writes one entry, redacted.
 *
 * @param db - Database port.
 * @param entry - What happened.
 */
async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  const json = (state: unknown) =>
    state === null ? null : JSON.stringify(redactPii(state));
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
