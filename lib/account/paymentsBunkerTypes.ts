/**
 * Contract of the payments mode switch (FC 075, K-75 second part): the owner or an administrator
 * asks for the change, the owner alone confirms it with the canonical phrase and the second
 * factor, and the confirmation records an approval the start of the API demands. Zod only, so the
 * browser can share it (ADR 0008). No secret of a processor and no one-time code is ever answered.
 *
 * @module
 */
import { z } from 'zod';

const mode = z.enum(['sandbox', 'live']);

/** `POST /v1/admin/payments/mode/prepare`: the mode asked for, and why. */
export const paymentModePrepareSchema = z.strictObject({
  targetMode: mode,
  reason: z.string().trim().min(1).max(255),
});

/** The ticket of a request: what the owner confirms within ten minutes. */
export const paymentModeTicketSchema = z.strictObject({
  challengeId: z.string(),
  targetMode: mode,
  expiresAt: z.string(),
});

/** `POST /v1/admin/payments/mode/confirm`: the ticket, the phrase and the code of the app. */
export const paymentModeConfirmSchema = z.strictObject({
  challengeId: z.string().regex(/^[0-9a-f]{64}$/),
  confirmationPhrase: z.string().max(64),
  totpCode: z.string().regex(/^\d{6}$/),
});

/** An approval recorded: the operator then changes the mode in the environment and redeploys. */
export const paymentModeApprovalSchema = z.strictObject({
  code: z.literal('SWITCH_PERMITTED'),
  targetMode: mode,
  /** The moment by which the approved mode must be started to stay approved, ISO 8601. */
  approvalExpiresAt: z.string(),
});
