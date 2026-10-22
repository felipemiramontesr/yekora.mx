/**
 * T1.4 · OrderSettlementFsmGate(P, S, E) of FC 012 (amended, 116_AN, confirmed by Ω): what a
 * confirmed and reconciled payment does to its order. A pure table of the 8 rows, so each row
 * — the four conflicts included (118_AN) — is proven by calling it; the webhook derives P, S
 * and E from the order's single `status_id` and applies the row it gets.
 *
 * @module
 */

/** The codes of T1.4. */
type SettlementCode =
  | 'ORDER_PAID'
  | 'ALREADY_PAID'
  | 'LATE_PAYMENT_NEEDS_REVIEW'
  | 'PAYMENT_NEEDS_REVIEW_ALERT'
  | 'STATE_CONFLICT_ANOMALY';

/** One row of T1.4 and its effect on the order. */
interface Settlement {
  /** Code of the row. */
  code: SettlementCode;
  /** HTTP status the webhook answers. */
  httpStatus: 200 | 500;
  /** Status the order moves to; null leaves it as it is. */
  nextStatusId: 2 | 6 | null;
  /** Whether the event is recorded as an alert for manual review. */
  alert: boolean;
  /** Whether the reserved units become sold (stock and reservation both go down). */
  sellsStock: boolean;
}

const row = (
  code: SettlementCode,
  nextStatusId: Settlement['nextStatusId'],
  alert: boolean,
  sellsStock = false
): Settlement => ({
  code,
  httpStatus: code === 'STATE_CONFLICT_ANOMALY' ? 500 : 200,
  nextStatusId,
  alert,
  sellsStock,
});

const CONFLICT = row('STATE_CONFLICT_ANOMALY', null, true);

/** Keyed by P S E as 0/1. */
const T1_4: Readonly<Record<string, Settlement>> = {
  '100': row('ORDER_PAID', 2, false, true),
  '010': row('ALREADY_PAID', null, false),
  '001': row('LATE_PAYMENT_NEEDS_REVIEW', 6, true),
  '000': row('PAYMENT_NEEDS_REVIEW_ALERT', null, true),
  '110': CONFLICT,
  '101': CONFLICT,
  '011': CONFLICT,
  '111': CONFLICT,
};

/**
 * Evaluates T1.4.
 *
 * @param pending - P: the order is PENDING_PAYMENT.
 * @param sameSettled - S: the order is PAID by this same processor resource.
 * @param late - E: the order is EXPIRED or CANCELLED.
 * @returns The row of the table.
 */
export function settle(
  pending: boolean,
  sameSettled: boolean,
  late: boolean
): Settlement {
  return T1_4[`${Number(pending)}${Number(sameSettled)}${Number(late)}`];
}
