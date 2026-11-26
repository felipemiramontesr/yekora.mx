/**
 * Operational alerts of the payments (FC 075 F3, K-75 second part, T2.4): mail to the owner and
 * the administrators when a mode change is approved, when a processor stops answering, and when
 * webhooks with a bad signature repeat. The mail goes through the outbox (ADR 0013) and carries
 * no secret and no buyer's data.
 *
 * @module
 */
import { recordAudit } from './audit';
import type { TxQuery } from './db';
import { enqueueMail } from './outbox';

/** The rejected signatures of the last ten minutes that raise the alert (T2.4). */
const SIGNATURE_ALERT_THRESHOLD = 10;
/** The most rejections kept in the audit log per window, so a flood cannot fill it. */
const SIGNATURE_LOG_CEILING = 100;
const SIGNATURE_WINDOW_MS = 10 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** The owner and the administrators whose accounts are active. */
async function privilegedUsers(db: TxQuery): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    "SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id WHERE u.is_active = 1 AND ur.role_id IN ('owner', 'admin')"
  );
  return rows.map((row) => row.id);
}

/**
 * Queues the notice of an approved mode change to the owner and the administrators.
 *
 * @param tx - The transaction of the approval.
 * @param targetMode - The mode approved.
 */
export async function alertModeApproved(
  tx: TxQuery,
  targetMode: 'sandbox' | 'live'
): Promise<void> {
  await Promise.all(
    (await privilegedUsers(tx)).map((userId) =>
      enqueueMail(tx, { type: 'PAYMENTS_MODE_APPROVED', userId, targetMode })
    )
  );
}

/** How many audit entries of an action and entity happened since a moment. */
async function countSince(
  db: TxQuery,
  action: string,
  entityId: string,
  since: Date
): Promise<number> {
  const [row] = await db.query<{ n: number | string }>(
    "SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'payments' AND action = ? AND entity_id = ? AND created_at >= ?",
    [action, entityId, since]
  );
  return Number(row.n);
}

/** One system entry of the payments in the audit log. */
function note(
  db: TxQuery,
  action: string,
  entityId: string,
  ip: string | null
) {
  return recordAudit(db, {
    userId: null,
    action,
    entityType: 'payments',
    entityId,
    before: null,
    after: null,
    ip,
  });
}

/**
 * Records that a processor did not answer the health probe and, at most once per hour and
 * processor, tells the owner and the administrators.
 *
 * @param db - Database port.
 * @param processor - `STRIPE` or `MERCADO_PAGO`.
 * @param now - Current time.
 * @returns True when an alert was queued.
 */
export async function noteProbeFailure(
  db: TxQuery,
  processor: string,
  now: Date
): Promise<boolean> {
  const since = new Date(now.getTime() - HOUR_MS);
  if ((await countSince(db, 'PAYMENTS_PROBE_FAILED', processor, since)) > 0) {
    return false;
  }
  await note(db, 'PAYMENTS_PROBE_FAILED', processor, null);
  await Promise.all(
    (await privilegedUsers(db)).map((userId) =>
      enqueueMail(db, { type: 'PAYMENTS_PROBE_FAILED', userId, processor })
    )
  );
  return true;
}

/**
 * Records a webhook whose signature did not match and, when ten or more arrived in ten minutes,
 * tells the owner and the administrators, once per hour.
 *
 * @param db - Database port.
 * @param rejected - The processor and the client address.
 * @param now - Current time.
 * @returns True when an alert was queued.
 */
export async function noteRejectedSignature(
  db: TxQuery,
  rejected: { processor: string; ip: string | null },
  now: Date
): Promise<boolean> {
  const { processor, ip } = rejected;
  const since = new Date(now.getTime() - SIGNATURE_WINDOW_MS);
  const before = await countSince(
    db,
    'WEBHOOK_SIGNATURE_REJECTED',
    processor,
    since
  );
  if (before >= SIGNATURE_LOG_CEILING) return false;
  await note(db, 'WEBHOOK_SIGNATURE_REJECTED', processor, ip);
  if (before + 1 < SIGNATURE_ALERT_THRESHOLD) return false;
  const hour = new Date(now.getTime() - HOUR_MS);
  if (
    (await countSince(db, 'WEBHOOK_SIGNATURE_ANOMALY', processor, hour)) > 0
  ) {
    return false;
  }
  await note(db, 'WEBHOOK_SIGNATURE_ANOMALY', processor, ip);
  await Promise.all(
    (await privilegedUsers(db)).map((userId) =>
      enqueueMail(db, { type: 'WEBHOOK_SIGNATURE_ANOMALY', userId, processor })
    )
  );
  return true;
}
