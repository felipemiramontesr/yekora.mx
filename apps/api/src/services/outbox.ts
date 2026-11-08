/**
 * The outbox (FC 028 F1, ADR 0013, T1.3 T, T2.4b): a route never sends mail, it queues it in
 * `outbox_events` inside the same transaction as the change it reports, then marks the request
 * so app.ts wakes the dispatcher once the answer has left. This module has no SMTP client; only
 * services/outboxDispatcher.ts does (scripts/checkPlatformGuards.ts).
 *
 * A payload carries ids and ciphertext only: the recipient's address is looked up when the
 * message is sent, and a sign-in code waits encrypted under TOTP_ENCRYPTION_KEY.
 *
 * @module
 */
import type { TxQuery } from './db';

/** The mail the API sends. */
export type MailEvent =
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
