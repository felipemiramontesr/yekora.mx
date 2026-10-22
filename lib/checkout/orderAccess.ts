/**
 * The buyer's access to the order just placed (FC 012 F3), kept in this tab's session storage
 * under `yekora_order_access_v1`: the order number, its access token and the hosted payment
 * page.
 *
 * The token never goes into a URL, so no processor, log or Referer header ever sees it (F2
 * declaration: this replaces the `#t=` fragment). The return pages read it here and send it in
 * `Authorization`. Session storage lives only while the tab is open and is not shared with other
 * tabs; the payment page link lets the buyer go back to the same order instead of opening a
 * second one that would hold the stock twice.
 *
 * @module
 */

const STORAGE_KEY = 'yekora_order_access_v1';
const ORDER_NUMBER = /^YEK-\d{4}-[0-9A-Z]{8}$/;
const TOKEN = /^[\w-]{43}$/;

/** What the return pages need to read and resume one order. */
export interface OrderAccess {
  /** e.g. YEK-2026-7F3K9QX2. */
  orderNumber: string;
  /** Capability token of the order (43 base64url characters). */
  accessToken: string;
  /** Hosted payment page of the order. */
  redirectUrl: string;
}

function sessionStore(): Storage | null {
  try {
    return globalThis.window === undefined
      ? null
      : globalThis.window.sessionStorage;
  } catch {
    return null; // storage blocked by the browser
  }
}

/**
 * Remembers the order just created, replacing any earlier one of this tab.
 *
 * @param access - Order number, token and payment page.
 * @param storage - Session storage, injectable for tests.
 * @returns False when the browser refused to store it (the return page will not find it).
 */
export function rememberOrder(
  access: OrderAccess,
  storage: Storage | null = sessionStore()
): boolean {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(access));
    return storage !== null;
  } catch {
    return false; // quota or privacy mode
  }
}

/**
 * The order this tab placed last, if it is still stored and well formed.
 *
 * @param storage - Session storage, injectable for tests.
 */
export function recallOrder(
  storage: Storage | null = sessionStore()
): OrderAccess | null {
  let value: Partial<OrderAccess> | null;
  try {
    value = JSON.parse(
      storage?.getItem(STORAGE_KEY) ?? 'null'
    ) as Partial<OrderAccess> | null;
  } catch {
    return null; // blocked storage or a value that is not JSON
  }
  const { orderNumber, accessToken, redirectUrl } = value ?? {};
  if (
    typeof orderNumber !== 'string' ||
    typeof accessToken !== 'string' ||
    typeof redirectUrl !== 'string' ||
    !ORDER_NUMBER.test(orderNumber) ||
    !TOKEN.test(accessToken)
  ) {
    return null;
  }
  return { orderNumber, accessToken, redirectUrl };
}
