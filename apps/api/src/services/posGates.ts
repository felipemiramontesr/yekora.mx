/**
 * The pure gates of the point of sale (FC 076, K-79): whether a sale may go (T1.1 stock and shift,
 * T1.3 payment), whether a shift may close (T1.2) and whether cash may leave the drawer (T1.4).
 * Each answers with the first condition that fails, in the order of its table.
 *
 * @module
 */

/** A difference above this, in MXN cents, needs a supervisor to close the shift. */
export const SUPERVISOR_DIFF_CENTS = 10_000;
/** A withdrawal above this, in MXN cents, needs a supervisor. */
export const SUPERVISOR_WITHDRAWAL_CENTS = 200_000;
/** The least a justification of a difference may say. */
export const MIN_NOTES = 10;

/** The rows of T1.1. */
export type SaleStockCode =
  | 'SALE_PERMITTED'
  | 'INSUFFICIENT_STOCK_REJECT'
  | 'STOCK_RESERVED_ONLINE_REJECT'
  | 'POS_SHIFT_CLOSED_REJECT';

/**
 * T1.1 · PosInventorySaleGate(S, R, C).
 *
 * @param inputs - Stock covers the units, the unreserved stock covers them, a shift is open.
 * @returns The row of the table that applies.
 */
export function decideSaleStock(inputs: {
  stock: boolean;
  unreserved: boolean;
  shiftOpen: boolean;
}): SaleStockCode {
  if (!inputs.stock) return 'INSUFFICIENT_STOCK_REJECT';
  if (!inputs.unreserved) return 'STOCK_RESERVED_ONLINE_REJECT';
  return inputs.shiftOpen ? 'SALE_PERMITTED' : 'POS_SHIFT_CLOSED_REJECT';
}

/** The rows of T1.2. */
export type CloseCode =
  | 'SHIFT_CLOSED_SUCCESS'
  | 'PERMISSION_DENIED'
  | 'SHIFT_NOT_OPEN_REJECT'
  | 'MISSING_DIFF_JUSTIFICATION_REJECT'
  | 'SUPERVISOR_REQUIRED_FOR_LARGE_DIFF';

/**
 * T1.2 · PosShiftCloseGate(A, S, D, N, P).
 *
 * @param inputs - May close, the shift is open, the count matches, the notes are enough and the
 *   difference is within the limit or the actor is a supervisor.
 * @returns The row of the table that applies.
 */
export function decideShiftClose(inputs: {
  allowed: boolean;
  open: boolean;
  matches: boolean;
  notes: boolean;
  withinLimit: boolean;
}): CloseCode {
  if (!inputs.allowed) return 'PERMISSION_DENIED';
  if (!inputs.open) return 'SHIFT_NOT_OPEN_REJECT';
  if (inputs.matches) return 'SHIFT_CLOSED_SUCCESS';
  if (!inputs.notes) return 'MISSING_DIFF_JUSTIFICATION_REJECT';
  return inputs.withinLimit
    ? 'SHIFT_CLOSED_SUCCESS'
    : 'SUPERVISOR_REQUIRED_FOR_LARGE_DIFF';
}

/** The rows of T1.4. */
export type WithdrawalCode =
  | 'WITHDRAWAL_PERMITTED'
  | 'PERMISSION_DENIED'
  | 'SHIFT_NOT_OPEN_REJECT'
  | 'INSUFFICIENT_DRAWER_CASH_REJECT'
  | 'SUPERVISOR_PERMISSION_REQUIRED';

/**
 * T1.4 · PosCashWithdrawalGate(A, S, F, L).
 *
 * @param inputs - May move cash, the shift is open, the drawer holds it, and it is within the limit
 *   or the actor is a supervisor.
 * @returns The row of the table that applies.
 */
export function decideWithdrawal(inputs: {
  allowed: boolean;
  open: boolean;
  funds: boolean;
  withinLimit: boolean;
}): WithdrawalCode {
  if (!inputs.allowed) return 'PERMISSION_DENIED';
  if (!inputs.open) return 'SHIFT_NOT_OPEN_REJECT';
  if (!inputs.funds) return 'INSUFFICIENT_DRAWER_CASH_REJECT';
  return inputs.withinLimit
    ? 'WITHDRAWAL_PERMITTED'
    : 'SUPERVISOR_PERMISSION_REQUIRED';
}

/** The rows of T1.3. */
export type PaymentCode =
  | 'PAYMENT_VALID_ACCEPTED'
  | 'INVALID_POS_METHOD_REJECT'
  | 'INSUFFICIENT_TENDERED_REJECT'
  | 'TERMINAL_AMOUNT_MISMATCH_REJECT'
  | 'INVALID_VOUCHER_DATA_REJECT';

/**
 * T1.3 · PosPaymentValidationGate(M, E, C, A).
 *
 * @param inputs - The method is one of the counter's, the cash covers the total, the terminal
 *   charged exactly the total and the voucher data is complete.
 * @returns The row of the table that applies.
 */
export function decidePayment(inputs: {
  method: boolean;
  tendered: boolean;
  amount: boolean;
  voucher: boolean;
}): PaymentCode {
  if (!inputs.method) return 'INVALID_POS_METHOD_REJECT';
  if (!inputs.tendered) return 'INSUFFICIENT_TENDERED_REJECT';
  if (!inputs.amount) return 'TERMINAL_AMOUNT_MISMATCH_REJECT';
  return inputs.voucher
    ? 'PAYMENT_VALID_ACCEPTED'
    : 'INVALID_VOUCHER_DATA_REJECT';
}
