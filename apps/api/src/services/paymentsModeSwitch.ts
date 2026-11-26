/**
 * The payments mode switch (FC 075, K-75 second part, T1.1, T0.3, T2.1). The mode of a running API
 * is declared in its environment and never flips in place (FC 070): the switch records an
 * approval that the start of the API demands (services/paymentsModeGate.ts). The one store is
 * `payments_mode_tickets`: a ticket asked by the owner or an administrator, confirmed by the owner
 * alone with the canonical phrase and the second factor, with at most three attempts.
 *
 * @module
 */
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import type {
  paymentModeApprovalSchema,
  paymentModeTicketSchema,
} from '../../../../lib/account/paymentsBunkerTypes';
import type { PaymentsConfig } from '../config';
import { recordAudit } from './audit';
import type { TxQuery } from './db';
import { alertModeApproved } from './paymentAlerts';
import { decideModeSwitch, type SwitchCode } from './paymentGates';
import { verifyStepUpTotp } from './totpStepUp';

type Mode = PaymentsConfig['mode'];

/** Ten minutes to confirm a ticket, three attempts, and 24 hours to start the approved mode. */
const TICKET_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const APPROVAL_MS = 24 * 60 * 60 * 1000;

/** The words the owner types, so a switch is never an accident (T1.1 P). */
const PHRASES: Record<Mode, string> = {
  live: 'CONFIRMAR_CAMBIO_A_LIVE',
  sandbox: 'CONFIRMAR_CAMBIO_A_SANDBOX',
};

/** Who asks or confirms, from where. */
interface Actor {
  userId: string;
  ip: string | null;
}

/**
 * Records a request to change the mode (a ticket of ten minutes).
 *
 * @param tx - Transaction.
 * @param request - The mode asked for, the reason and the mode of this API.
 * @param actor - Who asks.
 * @param now - Current time.
 * @returns The ticket, or `SWITCH_TARGET_UNCHANGED` when the API already runs that mode.
 */
export async function prepareModeSwitch(
  tx: TxQuery,
  request: { targetMode: Mode; reason: string; currentMode: Mode },
  actor: Actor,
  now: Date
): Promise<
  z.infer<typeof paymentModeTicketSchema> | 'SWITCH_TARGET_UNCHANGED'
> {
  if (request.targetMode === request.currentMode) {
    return 'SWITCH_TARGET_UNCHANGED';
  }
  const challengeId = randomBytes(32).toString('hex');
  const expiresAt = new Date(now.getTime() + TICKET_MS);
  await tx.query(
    'INSERT INTO payments_mode_tickets (challenge_id, target_mode, requested_by, reason, expires_at) VALUES (?, ?, ?, ?, ?)',
    [challengeId, request.targetMode, actor.userId, request.reason, expiresAt]
  );
  await recordAudit(tx, {
    userId: actor.userId,
    action: 'PAYMENTS_MODE_PREPARED',
    entityType: 'payments',
    entityId: request.targetMode,
    before: { mode: request.currentMode },
    after: { mode: request.targetMode },
    ip: actor.ip,
  });
  return {
    challengeId,
    targetMode: request.targetMode,
    expiresAt: expiresAt.toISOString(),
  };
}

/** The columns of a ticket a confirmation reads. */
interface Ticket {
  id: number;
  target_mode: Mode;
  status: string;
  attempts: number;
  expires_at: Date;
}

/** Counts a failed phrase or code, and closes the ticket at the third. */
async function failedAttempt(tx: TxQuery, ticket: Ticket): Promise<void> {
  const attempts = Number(ticket.attempts) + 1;
  await tx.query(
    'UPDATE payments_mode_tickets SET attempts = ?, status = ? WHERE id = ?',
    [attempts, attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING', ticket.id]
  );
}

/** The confirmation of a ticket. */
interface Confirmation {
  challengeId: string;
  confirmationPhrase: string;
  totpCode: string;
  owner: boolean;
  totpKey: Buffer;
}

/** The ticket if it can still be confirmed; a pending one that ran out is marked as such. */
async function openTicket(
  tx: TxQuery,
  challengeId: string,
  now: Date
): Promise<Ticket | null> {
  const [ticket] = await tx.query<Ticket>(
    'SELECT id, target_mode, status, attempts, expires_at FROM payments_mode_tickets WHERE challenge_id = ? FOR UPDATE',
    [challengeId]
  );
  if (ticket?.status !== 'PENDING') return null;
  if (new Date(ticket.expires_at).getTime() > now.getTime()) return ticket;
  await tx.query(
    "UPDATE payments_mode_tickets SET status = 'EXPIRED' WHERE id = ?",
    [ticket.id]
  );
  return null;
}

/** Records why a confirmation was refused, counting the attempt when the person got it wrong. */
async function refused(
  tx: TxQuery,
  ticket: Ticket,
  decision: SwitchCode,
  actor: Actor
): Promise<SwitchCode> {
  if (decision !== 'SWITCH_OWNER_REQUIRED') await failedAttempt(tx, ticket);
  await recordAudit(tx, {
    userId: actor.userId,
    action: 'PAYMENTS_STEP_UP_FAILED',
    entityType: 'payments',
    entityId: ticket.target_mode,
    before: null,
    after: { reason: decision },
    ip: actor.ip,
  });
  return decision;
}

/**
 * Confirms a ticket (T1.1): the approval of the mode, good for 24 hours until the API starts in
 * it. A wrong phrase or code counts an attempt, and the third closes the ticket.
 *
 * @param tx - Transaction; a refusal writes only its attempt and its audit.
 * @param input - The ticket, the phrase, the code, whether who confirms is the owner and the key.
 * @param actor - Who confirms.
 * @param now - Current time.
 * @returns The approval, or the row of T1.1 that refused it.
 */
export async function confirmModeSwitch(
  tx: TxQuery,
  input: Confirmation,
  actor: Actor,
  now: Date
): Promise<z.infer<typeof paymentModeApprovalSchema> | SwitchCode> {
  const ticket = await openTicket(tx, input.challengeId, now);
  if (ticket === null) return 'SWITCH_CHALLENGE_INVALID';
  const phrase = input.confirmationPhrase === PHRASES[ticket.target_mode];
  const stepUp = phrase
    ? await verifyStepUpTotp(tx, {
        userId: actor.userId,
        code: input.totpCode,
        totpKey: input.totpKey,
        now,
      })
    : null;
  const decision = decideModeSwitch({
    challenge: true,
    phrase,
    totp: stepUp === 'STEP_UP_GRANTED_200',
    owner: input.owner,
  });
  if (decision !== 'SWITCH_PERMITTED') {
    return refused(tx, ticket, decision, actor);
  }
  const approvalExpiresAt = new Date(now.getTime() + APPROVAL_MS);
  await tx.query(
    "UPDATE payments_mode_tickets SET status = 'CONSUMED', consumed_at = ?, confirmed_by = ?, approval_expires_at = ? WHERE id = ?",
    [now, actor.userId, approvalExpiresAt, ticket.id]
  );
  await recordAudit(tx, {
    userId: actor.userId,
    action: 'PAYMENTS_MODE_APPROVED',
    entityType: 'payments',
    entityId: ticket.target_mode,
    before: null,
    after: { mode: ticket.target_mode },
    ip: actor.ip,
  });
  await alertModeApproved(tx, ticket.target_mode);
  return {
    code: 'SWITCH_PERMITTED',
    targetMode: ticket.target_mode,
    approvalExpiresAt: approvalExpiresAt.toISOString(),
  };
}
