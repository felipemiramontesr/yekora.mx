/**
 * Purge of the sandbox orders before going live (FC 027 T2.1, ADR 0012 context: Ω tests in
 * production with Mercado Pago sandbox, 241_AN §4).
 *
 * The batch is all or nothing. It is locked (`FOR UPDATE`) and judged as a whole before any
 * DELETE runs: one order with `is_test = 0`, one live payment event, one unknown order number or
 * one order whose stock is not settled aborts it with zero deletes. Only then are the rows
 * deleted, children first (`payment_events` → `order_items` → `orders`), because every foreign
 * key to `orders` is `ON DELETE RESTRICT`.
 *
 * Stock is reported, never rewritten. A pending order still holds `reserved_stock` and an order
 * under review has not settled it, so both abort. A paid (or later refunded) test order already
 * took its units out of `stock` (services/webhooks.ts); the purge returns that count so Ω can
 * correct the inventory on purpose instead of having it silently restored.
 *
 * @module
 */
import type { Transactional, TxQuery } from '../../apps/api/src/services/db';

/** Statuses whose stock is settled, so the order can go without leaving a reservation behind. */
export const PURGEABLE_STATUSES = [
  'PAID',
  'EXPIRED',
  'CANCELLED',
  'REFUNDED',
] as const;

/** Statuses whose units already left `stock` when the payment settled. */
const SOLD_STATUSES = ['PAID', 'REFUNDED'];

/** Which orders a purge takes. */
export type PurgeSelection =
  /** Every order marked `is_test = 1`. */
  | { kind: 'all-test' }
  /** Exactly these order numbers; every one must exist and be a test order. */
  | { kind: 'orders'; orderNumbers: readonly string[] };

/** One locked candidate, as the guard reads it. */
export interface PurgeCandidate {
  /** Primary key of the order. */
  id: number;
  /** Public order number (YEK-YYYY-XXXXXXXX). */
  order_number: string;
  /** Code of the order status. */
  status: string;
  /** Sandbox marker of the order (0 or 1). */
  is_test: number;
  /** Payment events of the order with `is_test = 0`. */
  live_events: number;
}

/** Why a batch was refused; nothing was deleted. */
export type PurgeAbortCode =
  | 'NOTHING_TO_PURGE'
  | 'UNKNOWN_ORDER'
  | 'LIVE_ORDER_IN_BATCH'
  | 'LIVE_EVENT_IN_BATCH'
  | 'UNSETTLED_ORDER_IN_BATCH';

/** Verdict of the guard on a whole batch. */
export type BatchVerdict =
  | { ok: true; orderIds: number[] }
  | { ok: false; code: PurgeAbortCode; orderNumbers: string[] };

/** What a purge did, or would do in a dry run. */
export type PurgeOutcome =
  | {
      ok: true;
      /** True when nothing was deleted on purpose. */
      dryRun: boolean;
      /** Orders deleted (or to delete). */
      orders: number;
      /** Order lines deleted (or to delete). */
      items: number;
      /** Payment events deleted (or to delete). */
      events: number;
      /** Units that paid test orders took out of `stock`; the purge does not put them back. */
      soldUnits: number;
    }
  | {
      ok: false;
      dryRun: boolean;
      code: PurgeAbortCode;
      orderNumbers: string[];
    };

/**
 * Judges a locked batch as a whole (T2.1): the purge may go only if every order is a settled
 * test order with no live payment event, and every requested order number was found.
 *
 * @param candidates - The locked orders of the batch.
 * @param requested - The order numbers asked for, or null when the batch is every test order.
 * @returns The ids to delete, or the first reason to abort and the orders that caused it.
 */
export function judgeBatch(
  candidates: readonly PurgeCandidate[],
  requested: readonly string[] | null
): BatchVerdict {
  const found = new Set(candidates.map((row) => row.order_number));
  const missing = (requested ?? []).filter((number) => !found.has(number));
  if (missing.length > 0)
    return { ok: false, code: 'UNKNOWN_ORDER', orderNumbers: missing };
  if (candidates.length === 0)
    return { ok: false, code: 'NOTHING_TO_PURGE', orderNumbers: [] };
  const offenders = (
    code: PurgeAbortCode,
    test: (row: PurgeCandidate) => boolean
  ): BatchVerdict | null => {
    const rows = candidates.filter(test);
    return rows.length > 0
      ? { ok: false, code, orderNumbers: rows.map((row) => row.order_number) }
      : null;
  };
  const settled: readonly string[] = PURGEABLE_STATUSES;
  return (
    offenders('LIVE_ORDER_IN_BATCH', (row) => Number(row.is_test) !== 1) ??
    offenders('LIVE_EVENT_IN_BATCH', (row) => Number(row.live_events) > 0) ??
    offenders(
      'UNSETTLED_ORDER_IN_BATCH',
      (row) => !settled.includes(row.status)
    ) ?? { ok: true, orderIds: candidates.map((row) => row.id) }
  );
}

/** Locks the batch the selection names (static SQL, ADR 0003). */
function lockCandidates(
  tx: TxQuery,
  selection: PurgeSelection
): Promise<PurgeCandidate[]> {
  if (selection.kind === 'all-test') {
    return tx.query<PurgeCandidate>(
      'SELECT o.id, o.order_number, s.code AS status, o.is_test, (SELECT COUNT(*) FROM payment_events e WHERE e.order_id = o.id AND e.is_test = 0) AS live_events FROM orders o JOIN order_statuses s ON s.id = o.status_id WHERE o.is_test = 1 FOR UPDATE'
    );
  }
  if (selection.orderNumbers.length === 0) return Promise.resolve([]);
  return tx.query<PurgeCandidate>(
    'SELECT o.id, o.order_number, s.code AS status, o.is_test, (SELECT COUNT(*) FROM payment_events e WHERE e.order_id = o.id AND e.is_test = 0) AS live_events FROM orders o JOIN order_statuses s ON s.id = o.status_id WHERE o.order_number IN (?) FOR UPDATE',
    [selection.orderNumbers]
  );
}

/**
 * Purges a batch of sandbox orders in one transaction (T2.1). The guard runs on the locked rows
 * before any DELETE; a refused batch deletes nothing.
 *
 * @param db - Database with transactions.
 * @param selection - Every test order, or an explicit list of order numbers.
 * @param options - `dryRun` counts what would go and deletes nothing.
 * @returns Counts of what was (or would be) deleted, or why the batch was refused.
 */
export function purgeSandboxOrders(
  db: Transactional,
  selection: PurgeSelection,
  options: { dryRun: boolean }
): Promise<PurgeOutcome> {
  const { dryRun } = options;
  return db.transaction(async (tx) => {
    const candidates = await lockCandidates(tx, selection);
    const verdict = judgeBatch(
      candidates,
      selection.kind === 'orders' ? selection.orderNumbers : null
    );
    if (!verdict.ok) return { ...verdict, dryRun };
    const ids = verdict.orderIds;
    const [lines] = await tx.query<{ items: number; sold_units: number }>(
      'SELECT COUNT(*) AS items, COALESCE(SUM(CASE WHEN s.code IN (?) THEN i.quantity ELSE 0 END), 0) AS sold_units FROM order_items i JOIN orders o ON o.id = i.order_id JOIN order_statuses s ON s.id = o.status_id WHERE i.order_id IN (?)',
      [SOLD_STATUSES, ids]
    );
    const [events] = await tx.query<{ events: number }>(
      'SELECT COUNT(*) AS events FROM payment_events WHERE order_id IN (?)',
      [ids]
    );
    if (!dryRun) {
      await tx.query('DELETE FROM payment_events WHERE order_id IN (?)', [ids]);
      await tx.query('DELETE FROM order_items WHERE order_id IN (?)', [ids]);
      await tx.query('DELETE FROM orders WHERE id IN (?) AND is_test = 1', [
        ids,
      ]);
    }
    return {
      ok: true,
      dryRun,
      orders: ids.length,
      items: Number(lines.items),
      events: Number(events.events),
      soldUnits: Number(lines.sold_units),
    };
  });
}
