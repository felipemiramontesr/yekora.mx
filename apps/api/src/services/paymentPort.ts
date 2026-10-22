/**
 * Port of the payment processors (FC 012 F1, ADR 0009). The checkout core talks to Stripe and
 * Mercado Pago only through this contract, so orders, amounts and states live in Yekora and a
 * processor only collects the money on its hosted page (PCI DSS SAQ A).
 *
 * Adapters call fixed canonical hosts with `fetch` (no SDK, OWASP A10). Every amount is MXN
 * cents with VAT included and comes from the server's quote, never from the browser. The
 * processor's own expiry is always at least 30 minutes before the order's `expires_at`, so a
 * late payment is impossible by construction (FC 012 T2).
 *
 * @module
 */

/** Payment methods the buyer chooses in Yekora's checkout (`payment_methods.code`, 112_AN). */
export type PaymentMethodCode =
  'CARD' | 'OXXO' | 'SPEI' | 'MERCADO_PAGO_BALANCE';

/** Margin between the processor's expiry and the order's (FC 012 T2: 1 800 s). */
const REMOTE_EXPIRY_MARGIN_MS = 30 * 60 * 1000;

/** What a hosted payment session is created for. */
export interface SessionRequest {
  /** Yekora's order number, sent as the processor's external reference. */
  orderNumber: string;
  /** The single method this session accepts. */
  method: PaymentMethodCode;
  /** Order total, MXN cents with VAT included. */
  totalMxnCents: number;
  /** Text the hosted page shows for the charge. */
  description: string;
  /** When the order's stock reservation ends. */
  expiresAt: Date;
  /** Current time (injected so the expiry math is testable). */
  now: Date;
  /** Where the processor returns the buyer after paying. */
  successUrl: string;
  /** Where the processor returns the buyer after cancelling. */
  cancelUrl: string;
  /** Webhook endpoint of this processor in Yekora's API. */
  notificationUrl: string;
}

/** A hosted session ready for the buyer. */
export interface CreatedSession {
  /** The processor's id of the session or preference (`orders.processor_reference`). */
  reference: string;
  /** Hosted page to send the buyer to (validated host before navigating). */
  redirectUrl: string;
  /** Latest moment the processor can still accept the payment. */
  remoteExpiresAt: Date;
}

/** A webhook whose signature was verified over the raw bytes. */
export interface VerifiedEvent {
  /** The processor's event id: idempotency key with the processor id. */
  eventId: string;
  /** The processor's event type. */
  type: string;
  /** The id to reconcile against the processor (session or payment id), when present. */
  resourceId: string | null;
}

/** What the processor says about a payment, read back from its API (reconciliation). */
export interface PaymentStatus {
  /** True only when the processor reports it as paid. */
  paid: boolean;
  /** Amount the processor holds, MXN cents; null when it reports none. */
  amountMxnCents: number | null;
  /** Currency as the processor reports it, upper case. */
  currency: string | null;
  /** External reference: must equal the order number. */
  orderNumber: string | null;
  /** The processor's raw status word, kept for the event record. */
  processorStatus: string;
}

/** Headers and query of an incoming webhook, as the route received them. */
export interface WebhookInput {
  /** Exact request body bytes; signatures are computed over these. */
  rawBody: Buffer;
  /** Request headers, lower-case names. */
  headers: Readonly<Record<string, string | string[] | undefined>>;
  /** Query-string values. */
  query: Readonly<Record<string, string | undefined>>;
  /** Current time (signature freshness). */
  now: Date;
}

/** One payment processor. */
export interface PaymentProcessorPort {
  /**
   * Creates a hosted session for one order and one method.
   *
   * @param request - Order, method, amount and expiry.
   * @returns The session, or rejects with {@link PaymentProcessorError}.
   */
  createSession(request: SessionRequest): Promise<CreatedSession>;
  /**
   * Verifies a webhook signature over its raw bytes in constant time.
   *
   * @param input - Raw body, headers, query and current time.
   * @returns The verified event, or null when the signature does not hold.
   */
  verifyWebhook(input: WebhookInput): VerifiedEvent | null;
  /**
   * Reads a payment back from the processor (never trusts the webhook body alone).
   *
   * @param resourceId - Session or payment id from the verified event.
   */
  fetchPayment(resourceId: string): Promise<PaymentStatus>;
}

/** A processor call that failed; the message never carries secrets or payer data. */
export class PaymentProcessorError extends Error {
  /**
   * @param message - Safe description (processor and HTTP status at most).
   */
  constructor(message: string) {
    super(message);
    this.name = 'PaymentProcessorError';
  }
}

/**
 * Latest expiry the processor may get: the order's `expires_at` minus the 30-minute margin.
 *
 * @param expiresAt - The order's reservation end.
 */
export function remoteDeadline(expiresAt: Date): Date {
  return new Date(expiresAt.getTime() - REMOTE_EXPIRY_MARGIN_MS);
}
