/**
 * The outbox (FC 028 F1, ADR 0013, T1.3 T, T2.4b): a route never sends mail, it queues it in
 * `outbox_events` inside the same transaction as the change it reports, then marks the request
 * so app.ts wakes the dispatcher once the answer has left. This module has no SMTP client; only
 * services/outboxDispatcher.ts does (scripts/checkPlatformGuards.ts).
 *
 * A payload carries ids and ciphertext only: the recipient's address is looked up when the
 * message is sent, a sign-in code waits encrypted under TOTP_ENCRYPTION_KEY, and an order mail
 * carries just the order id (FC 066 T2.2).
 *
 * @module
 */
import type { TxQuery } from './db';

/**
 * The mail the API sends. Every event may name the language of its message (`locale`, FC 065
 * T1.1): `en` asks for English; anything else, or nothing, is Mexican Spanish. A message is
 * never written in both.
 */
export type MailEvent = (
  | {
      /** The 6-digit sign-in code of an `EMAIL` challenge. */
      type: 'SIGN_IN_CODE';
      userId: string;
      challengeId: string;
      /** `v1:` ciphertext of the code, bound to the challenge id. */
      code: string;
    }
  | {
      /** Security alert: the authenticator was turned on for the account. */
      type: 'TOTP_ENABLED';
      userId: string;
    }
  | {
      /** The 15-minute link of «¿Olvidaste tu contraseña?» (FC 042 T1.1). */
      type: 'PASSWORD_RESET';
      userId: string;
      /** `v1:` ciphertext of the link's token, bound to the user id. */
      token: string;
    }
  | {
      /** Security alert: the password changed through a reset link (FC 042 T2.3). */
      type: 'PASSWORD_CHANGED';
      userId: string;
    }
  | {
      /** The owner approved a change of the payments mode (FC 075, K-75). */
      type: 'PAYMENTS_MODE_APPROVED';
      userId: string;
      targetMode: 'sandbox' | 'live';
    }
  | {
      /** A processor did not answer the health probe (FC 075). */
      type: 'PAYMENTS_PROBE_FAILED';
      userId: string;
      processor: string;
    }
  | {
      /** Ten or more webhooks with a bad signature arrived in ten minutes (FC 075). */
      type: 'WEBHOOK_SIGNATURE_ANOMALY';
      userId: string;
      processor: string;
    }
  | {
      /** The receipt of a counter sale the buyer asked to get by e-mail (FC 076, K-79). */
      type: 'POS_RECEIPT_EMAIL';
      orderId: number;
    }
  | {
      /** The payment of an order was confirmed (FC 066, K-88). */
      type: 'ORDER_CONFIRMED';
      /** `orders.id`: the buyer's data is read and decrypted only when the mail is sent. */
      orderId: number;
    }
  | {
      /** The reservation of an order lapsed unpaid (FC 066). */
      type: 'ORDER_EXPIRED';
      orderId: number;
    }
  | {
      /** An order was cancelled because its payment page could not be opened (FC 066). */
      type: 'ORDER_CANCELLED';
      orderId: number;
    }
  | {
      /** An operator started preparing a paid order (FC 068, K-48). */
      type: 'ORDER_PREPARED';
      orderId: number;
    }
  | {
      /** The whole payment of an order was refunded at the processor (FC 069, K-76). */
      type: 'ORDER_REFUNDED';
      orderId: number;
    }
  | {
      /** A return was refunded, whole or in part (FC 071, K-80). */
      type: 'RETURN_REFUNDED';
      orderId: number;
      /** What went back, MXN cents. */
      refundMxnCents: number;
    }
  | {
      /** An operator shipped a paid order and registered its parcel (FC 068, K-48). */
      type: 'ORDER_SHIPPED';
      orderId: number;
    }
) & {
  /** The language the message asks for, if any. */
  locale?: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by a route that queued mail, so app.ts wakes the dispatcher after the answer. */
    outboxQueued: boolean;
  }
}

/**
 * Queues one message, in the caller's transaction.
 *
 * @param tx - The transaction of the change the message reports.
 * @param event - What to send.
 */
export async function enqueueMail(
  tx: TxQuery,
  event: MailEvent
): Promise<void> {
  const { type, ...payload } = event;
  await tx.query(
    'INSERT INTO outbox_events (event_type, payload) VALUES (?, ?)',
    [type, JSON.stringify(payload)]
  );
}
