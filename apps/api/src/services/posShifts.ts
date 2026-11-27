/**
 * The till shifts of the counter (FC 076 F1, K-79, T0.2, T1.2, T1.4, T2.3, T2.4). One shift is open
 * at a time, which the database itself enforces; the cash of a drawer is what it started with,
 * plus the cash sales of the shift, plus the cash put in, minus the cash taken out (the cash of a
 * counter return is one of those). The open shift never tells the expected cash: the count at
 * closing is blind.
 *
 * @module
 */
import type { z } from 'zod';
import type {
  cashMovementResultSchema,
  cashMovementSchema,
  closedShiftSchema,
  posShiftSchema,
} from '../../../../lib/account/posTypes';
import { recordAudit } from './audit';
import type { TxQuery } from './db';
import {
  type CloseCode,
  decideShiftClose,
  decideWithdrawal,
  MIN_NOTES,
  SUPERVISOR_DIFF_CENTS,
  SUPERVISOR_WITHDRAWAL_CENTS,
  type WithdrawalCode,
} from './posGates';

/** Who acts: the account, its permissions and where it comes from. */
export interface PosActor {
  userId: string;
  supervisor: boolean;
  ip: string | null;
}

/** The method of a cash sale (migration 020). */
const CASH_METHOD_ID = 5;

type Shift = z.infer<typeof posShiftSchema>;

/**
 * The open shift, without the expected cash.
 *
 * @param db - Database port.
 * @returns The shift, or null when the till is closed.
 */
export async function currentShift(db: TxQuery): Promise<Shift | null> {
  const [row] = await db.query<{
    id: number;
    cashier_user_id: string;
    opened_at: Date;
    opening_cash_mxn_cents: number | string;
  }>(
    "SELECT id, cashier_user_id, opened_at, opening_cash_mxn_cents FROM pos_shifts WHERE status = 'OPEN'"
  );
  return row
    ? {
        id: Number(row.id),
        cashierUserId: row.cashier_user_id,
        openedAt: new Date(row.opened_at).toISOString(),
        openingCashMxnCents: Number(row.opening_cash_mxn_cents),
      }
    : null;
}

/**
 * Opens a shift (T0.2): the unique key of the database refuses a second open one, even when two
 * requests arrive at once.
 *
 * @param tx - Transaction.
 * @param openingCashMxnCents - The cash the drawer starts with.
 * @param actor - Who opens.
 * @returns The new shift, or `POS_SHIFT_ALREADY_OPEN`.
 */
export async function openShift(
  tx: TxQuery,
  openingCashMxnCents: number,
  actor: PosActor
): Promise<Shift | 'POS_SHIFT_ALREADY_OPEN'> {
  try {
    await tx.query(
      'INSERT INTO pos_shifts (cashier_user_id, opening_cash_mxn_cents) VALUES (?, ?)',
      [actor.userId, openingCashMxnCents]
    );
  } catch (error) {
    if ((error as { code?: string }).code !== 'ER_DUP_ENTRY') throw error;
    return 'POS_SHIFT_ALREADY_OPEN';
  }
  const shift = (await currentShift(tx)) as Shift;
  await recordAudit(tx, {
    userId: actor.userId,
    action: 'POS_SHIFT_OPENED',
    entityType: 'pos_shifts',
    entityId: String(shift.id),
    before: null,
    after: { openingCashMxnCents },
    ip: actor.ip,
  });
  return shift;
}

/** The columns of a shift a write locks. */
interface ShiftRow {
  id: number;
  cashier_user_id: string;
  status: string;
  opening_cash_mxn_cents: number | string;
}

/** The shift, locked for the rest of the transaction. */
async function lockShift(
  tx: TxQuery,
  id: number
): Promise<ShiftRow | undefined> {
  const [row] = await tx.query<ShiftRow>(
    'SELECT id, cashier_user_id, status, opening_cash_mxn_cents FROM pos_shifts WHERE id = ? FOR UPDATE',
    [id]
  );
  return row;
}

/**
 * The cash a drawer holds now: opening, plus cash sales, plus cash put in, minus cash taken out.
 *
 * @param tx - Transaction.
 * @param shift - The locked shift.
 * @returns MXN cents.
 */
export async function drawerCash(
  tx: TxQuery,
  shift: Pick<ShiftRow, 'id' | 'opening_cash_mxn_cents'>
): Promise<number> {
  const [sales] = await tx.query<{ cents: number | string }>(
    'SELECT COALESCE(SUM(total_mxn_cents), 0) AS cents FROM orders WHERE pos_shift_id = ? AND payment_method_id = ?',
    [shift.id, CASH_METHOD_ID]
  );
  const [moves] = await tx.query<{ cents: number | string }>(
    "SELECT COALESCE(SUM(CASE WHEN type = 'IN' THEN amount_mxn_cents ELSE -CAST(amount_mxn_cents AS SIGNED) END), 0) AS cents FROM pos_cash_movements WHERE shift_id = ?",
    [shift.id]
  );
  return (
    Number(shift.opening_cash_mxn_cents) +
    Number(sales.cents) +
    Number(moves.cents)
  );
}

/**
 * Writes a movement of cash of a shift, already authorized.
 *
 * @param tx - Transaction.
 * @param movement - Shift, type, amount, reason and the return it pays, if any.
 * @param userId - Who authorized it.
 * @returns The identifier of the movement.
 */
export async function writeMovement(
  tx: TxQuery,
  movement: {
    shiftId: number;
    type: 'IN' | 'OUT';
    amountMxnCents: number;
    reason: string;
    returnId?: number;
  },
  userId: string
): Promise<number> {
  const result = await tx.query(
    'INSERT INTO pos_cash_movements (shift_id, type, amount_mxn_cents, reason, authorized_by_user_id, return_id) VALUES (?, ?, ?, ?, ?, ?)',
    [
      movement.shiftId,
      movement.type,
      movement.amountMxnCents,
      movement.reason,
      userId,
      movement.returnId ?? null,
    ]
  );
  return (result as unknown as { insertId: number }).insertId;
}

/**
 * Puts cash in or takes it out (T1.4): a withdrawal needs the drawer to hold it, and a supervisor
 * above 2,000 MXN.
 *
 * @param tx - Transaction.
 * @param input - The movement.
 * @param actor - Who moves the cash.
 * @returns The movement recorded, or the row of T1.4 that refused it.
 */
export async function moveCash(
  tx: TxQuery,
  input: z.infer<typeof cashMovementSchema>,
  actor: PosActor
): Promise<
  | z.infer<typeof cashMovementResultSchema>
  | Exclude<WithdrawalCode, 'WITHDRAWAL_PERMITTED'>
> {
  const shift = await lockShift(tx, input.shiftId);
  const open = shift?.status === 'OPEN';
  const isOut = input.type === 'OUT';
  const funds =
    !isOut || !open || input.amountMxnCents <= (await drawerCash(tx, shift));
  const decision = decideWithdrawal({
    allowed: true,
    open,
    funds,
    withinLimit:
      !isOut ||
      actor.supervisor ||
      input.amountMxnCents <= SUPERVISOR_WITHDRAWAL_CENTS,
  });
  if (decision !== 'WITHDRAWAL_PERMITTED') return decision;
  const id = await writeMovement(tx, input, actor.userId);
  await recordAudit(tx, {
    userId: actor.userId,
    action: 'POS_CASH_MOVED',
    entityType: 'pos_shifts',
    entityId: String(input.shiftId),
    before: null,
    after: { type: input.type, amountMxnCents: input.amountMxnCents },
    ip: actor.ip,
  });
  return {
    id,
    shiftId: input.shiftId,
    type: input.type,
    amountMxnCents: input.amountMxnCents,
  };
}

/**
 * Closes a shift with a blind count (T1.2): a difference needs a note of at least ten characters,
 * and above 100 MXN a supervisor. Only who opened the shift, or a supervisor, closes it.
 *
 * @param tx - Transaction.
 * @param id - The shift.
 * @param input - The cash counted and the notes.
 * @param actor - Who closes.
 * @param now - Current time.
 * @returns The count against what was expected, or the row of T1.2 that refused it.
 */
export async function closeShift(
  tx: TxQuery,
  id: number,
  input: { countedCashMxnCents: number; notes?: string },
  actor: PosActor,
  now: Date
): Promise<
  z.infer<typeof closedShiftSchema> | Exclude<CloseCode, 'SHIFT_CLOSED_SUCCESS'>
> {
  const shift = await lockShift(tx, id);
  if (shift === undefined) return 'SHIFT_NOT_OPEN_REJECT';
  const expected = await drawerCash(tx, shift);
  const difference = input.countedCashMxnCents - expected;
  const notes = input.notes ?? '';
  const decision = decideShiftClose({
    allowed: actor.supervisor || shift.cashier_user_id === actor.userId,
    open: shift.status === 'OPEN',
    matches: difference === 0,
    notes: notes.length >= MIN_NOTES,
    withinLimit:
      actor.supervisor || Math.abs(difference) <= SUPERVISOR_DIFF_CENTS,
  });
  if (decision !== 'SHIFT_CLOSED_SUCCESS') return decision;
  await tx.query(
    "UPDATE pos_shifts SET status = 'CLOSED', closed_at = ?, expected_cash_mxn_cents = ?, counted_cash_mxn_cents = ?, cash_difference_mxn_cents = ?, closed_by_user_id = ?, notes = ? WHERE id = ?",
    [
      now,
      expected,
      input.countedCashMxnCents,
      difference,
      actor.userId,
      notes === '' ? null : notes,
      id,
    ]
  );
  await recordAudit(tx, {
    userId: actor.userId,
    action: 'POS_SHIFT_CLOSED',
    entityType: 'pos_shifts',
    entityId: String(id),
    before: null,
    after: { differenceMxnCents: difference },
    ip: actor.ip,
  });
  return {
    id,
    expectedCashMxnCents: expected,
    countedCashMxnCents: input.countedCashMxnCents,
    differenceMxnCents: difference,
  };
}
