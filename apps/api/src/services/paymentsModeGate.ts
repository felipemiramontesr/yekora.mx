/**
 * The start-up gate of the live mode (FC 075 F2, T2.1): the API may start with
 * `PAYMENTS_MODE=live` only if the latest consumed approval is for `live`. An approval has 24 hours
 * to be activated; the first start in live records the activation, and from then on every restart
 * is valid while that approval stays the latest. Sandbox asks for nothing: it is the safe
 * direction. The check fails closed: if the database cannot answer, the API does not start.
 *
 * @module
 */
import type { PaymentsConfig } from '../config';
import type { TxQuery } from './db';

/** The latest approval consumed, as the gate reads it. */
interface Approval {
  id: number;
  target_mode: string;
  approval_expires_at: Date;
  activated_at: Date | null;
}

/**
 * Refuses to start in live without an approval of the owner, and activates a fresh one.
 *
 * @param db - Database port.
 * @param mode - `PAYMENTS_MODE` of this environment.
 * @param now - Current time.
 * @throws When the mode is live and no approval of live is the latest and still good.
 */
export async function assertPaymentsModeApproved(
  db: TxQuery,
  mode: PaymentsConfig['mode'],
  now: Date
): Promise<void> {
  if (mode !== 'live') return;
  const [latest] = await db.query<Approval>(
    "SELECT id, target_mode, approval_expires_at, activated_at FROM payments_mode_tickets WHERE status = 'CONSUMED' ORDER BY consumed_at DESC, id DESC LIMIT 1"
  );
  if (latest?.target_mode !== 'live') {
    throw new Error(
      'PAYMENTS_MODE=live has no approval of the owner: the latest consumed approval is not live'
    );
  }
  if (latest.activated_at !== null) return;
  if (new Date(latest.approval_expires_at).getTime() < now.getTime()) {
    throw new Error(
      'PAYMENTS_MODE=live: the approval of the owner expired before it was activated'
    );
  }
  await db.query(
    'UPDATE payments_mode_tickets SET activated_at = ? WHERE id = ? AND activated_at IS NULL',
    [now, latest.id]
  );
}
