/**
 * What the returns screens decide before they ask the API (FC 073, K-80 second part): whether the
 * buyer's order page offers «Solicitar devolución» (T1.1, T2.4) and which step of the board an
 * operator is offered on a request (T1.2a, T1.2b). The screens only explain: the API (FC 071)
 * decides every rule again and its refusal is the one that counts, so a stale page can never
 * return what the rules forbid.
 *
 * @module
 */
import type { OrderDetail } from './orderTypes';
import type { ReturnView } from './returnTypes';

/** The window to return what was delivered, in natural days (T2.4), as the API counts it. */
const RETURN_WINDOW_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When the window of an order delivered at `deliveredAt` closes: the delivery moment plus 60
 * natural days.
 *
 * @param deliveredAt - `deliveredAt` of the order, ISO 8601.
 * @returns The last moment a return may still be asked.
 */
export function returnWindowEndsAt(deliveredAt: string): Date {
  return new Date(
    new Date(deliveredAt).getTime() + RETURN_WINDOW_DAYS * DAY_MS
  );
}

/**
 * Whether `now` is still inside the window of an order delivered at `deliveredAt`: the delivery
 * moment plus 60 natural days, inclusive (T2.4), the same rule `withinReturnWindow` applies in
 * the API.
 *
 * @param deliveredAt - `deliveredAt` of the order, ISO 8601, or null when it was not delivered.
 * @param now - Current time.
 * @returns False without a delivery, or when the window is over.
 */
export function withinReturnWindow(
  deliveredAt: string | null | undefined,
  now: Date
): boolean {
  return (
    typeof deliveredAt === 'string' &&
    now.getTime() <= returnWindowEndsAt(deliveredAt).getTime()
  );
}

/** What a line of an order says about being returned. */
type ReturnableLine = Pick<
  OrderDetail['lines'][number],
  'quantity' | 'allowsReturn' | 'returnedQuantity'
>;

/**
 * The units of a line that can still come back: none when the product was sold as a final sale,
 * otherwise what was bought minus what any request already asked (T1.1 R and Q).
 *
 * @param line - A line of the order.
 * @returns A whole number from 0 to the units bought.
 */
export function returnableUnits(line: ReturnableLine): number {
  return line.allowsReturn
    ? Math.max(0, line.quantity - line.returnedQuantity)
    : 0;
}

/**
 * Whether the order page offers «Solicitar devolución» (T1.1 D, W, R and Q on the page): the
 * order was delivered, it is inside the window of 60 natural days, and at least one line has units
 * left to return. The owner (O) is the API's: the page only ever shows the buyer's own orders.
 *
 * @param order - The order as the buyer reads it.
 * @param now - Current time.
 * @returns True when the button is shown.
 */
export function canRequestReturn(
  order: Pick<OrderDetail, 'fulfillment' | 'deliveredAt'> & {
    lines: readonly ReturnableLine[];
  },
  now: Date
): boolean {
  return (
    order.fulfillment === 'DELIVERED' &&
    withinReturnWindow(order.deliveredAt, now) &&
    order.lines.some((line) => returnableUnits(line) > 0)
  );
}

/** What the board offers on one request. */
interface BoardActions {
  /** «Preparar»: only a request still `REQUESTED`, to whoever holds `returns:prepare` (T1.2a A, S). */
  prepare: boolean;
  /**
   * «Confirmar» on a `PREPARED` request, «Reintentar» on one `REFUNDING` (a retry with the same
   * key at the processor), nothing on `REQUESTED` (not prepared) or `REFUNDED` (done), and
   * only to whoever holds `returns:confirm` (T1.2b A, S).
   */
  confirm: 'confirm' | 'retry' | null;
}

/**
 * The steps of the board a request offers an operator. The control dual (T1.2b D) is not decided
 * here: the board does not know who prepared, so it offers the step and explains the API's refusal.
 *
 * @param status - The stage of the request.
 * @param grants - Whether the session holds `returns:prepare` and `returns:confirm`.
 * @returns The steps to offer.
 */
export function boardActionsOf(
  status: ReturnView['status'],
  grants: { canPrepare: boolean; canConfirm: boolean }
): BoardActions {
  let confirm: BoardActions['confirm'] = null;
  if (grants.canConfirm && status === 'PREPARED') confirm = 'confirm';
  if (grants.canConfirm && status === 'REFUNDING') confirm = 'retry';
  return { prepare: grants.canPrepare && status === 'REQUESTED', confirm };
}
