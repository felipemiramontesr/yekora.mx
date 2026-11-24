/**
 * The two gates of the returns (FC 071, K-80): whether a line of an order may be returned (T0.2 and
 * T1.1) and whether a refund may be confirmed (T1.2).
 *
 * The gate answers with the first thing that fails, in the order of the table: the order is not the
 * buyer's, it was not delivered, the window of 60 natural days since the delivery is over, the
 * product did not allow returns when it was bought, or the units asked are not the ones that can
 * still come back. Everything else is decided elsewhere.
 *
 * @module
 */

/** The window to return what was delivered, in natural days (T0.2). */
const RETURN_WINDOW_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The rows of T1.1 as the machine names them. */
export type EligibilityCode =
  | 'RETURN_ELIGIBLE_OK'
  | 'DATA_DOMAIN_FORBIDDEN'
  | 'ORDER_NOT_DELIVERED_REJECT'
  | 'WINDOW_EXPIRED_REJECT'
  | 'PRODUCT_NON_RETURNABLE_REJECT'
  | 'INVALID_QUANTITY_REJECT';

/** The five inputs of T1.1: O, D, W, A, Q. */
interface EligibilityInputs {
  /** O: the order belongs to the account that asks. */
  owner: boolean;
  /** D: the order was delivered. */
  delivered: boolean;
  /** W: the request is inside the window. */
  withinWindow: boolean;
  /** A: the line allowed returns when it was bought. */
  allowsReturn: boolean;
  /** Q: the units asked do not exceed the ones bought and not yet returned. */
  validQuantity: boolean;
}

/**
 * T1.1 · ReturnEligibilityGate(O, D, W, A, Q).
 *
 * @param inputs - The five conditions.
 * @returns The row of the table that applies.
 */
export function decideReturnLine(inputs: EligibilityInputs): EligibilityCode {
  if (!inputs.owner) return 'DATA_DOMAIN_FORBIDDEN';
  if (!inputs.delivered) return 'ORDER_NOT_DELIVERED_REJECT';
  if (!inputs.withinWindow) return 'WINDOW_EXPIRED_REJECT';
  if (!inputs.allowsReturn) return 'PRODUCT_NON_RETURNABLE_REJECT';
  return inputs.validQuantity
    ? 'RETURN_ELIGIBLE_OK'
    : 'INVALID_QUANTITY_REJECT';
}

/**
 * Whether `now` is still inside the window of an order delivered at `deliveredAt`: the delivery
 * moment plus 60 natural days, inclusive (T0.2).
 *
 * @param deliveredAt - `orders.delivered_at`, or null when the order was not delivered.
 * @param now - Current time.
 * @returns False without a delivery, or when the window is over.
 */
export function withinReturnWindow(
  deliveredAt: Date | null,
  now: Date
): boolean {
  return (
    deliveredAt !== null &&
    now.getTime() <=
      new Date(deliveredAt).getTime() + RETURN_WINDOW_DAYS * DAY_MS
  );
}

/** The rows of T1.2 as the machine names them. */
export type ConfirmationCode =
  | 'REFUND_CONFIRMED_EXECUTE'
  | 'RETURN_NOT_PREPARED_REJECT'
  | 'UNAUTHORIZED_CONFIRMER_REJECT'
  | 'DUAL_CONTROL_VIOLATION_REJECT'
  | 'INVALID_REFUND_AMOUNT_REJECT';

/**
 * T1.2 · DualControlRefundConfirmationGate(P, C, D, M).
 *
 * @param inputs - P: the request was prepared; C: the confirmer holds the permission with the second
 *   factor; D (as `samePerson`): the confirmer is the preparer; M: the amount is within the balance.
 * @returns The row of the table that applies.
 */
export function decideConfirmation(inputs: {
  prepared: boolean;
  authorized: boolean;
  samePerson: boolean;
  amountOk: boolean;
}): ConfirmationCode {
  if (!inputs.prepared) return 'RETURN_NOT_PREPARED_REJECT';
  if (!inputs.authorized) return 'UNAUTHORIZED_CONFIRMER_REJECT';
  if (inputs.samePerson) return 'DUAL_CONTROL_VIOLATION_REJECT';
  return inputs.amountOk
    ? 'REFUND_CONFIRMED_EXECUTE'
    : 'INVALID_REFUND_AMOUNT_REJECT';
}
