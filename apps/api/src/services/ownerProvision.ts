/**
 * The owner account, out of band (FC 044 F0, T1.1a, T1.1b, T2.2 to T2.4): the proprietor's
 * account holds the role `owner` (migration 008), which no HTTP route grants. It is created, and
 * in an emergency recovered, only from the server, by scripts/provisionOwner.ts.
 *
 * No temporary password exists (T2.2). A new account is born with a hash nobody can match and
 * receives the 15-minute reset link of FC 042; the holder types the real password in their own
 * browser. The e-mail of the account comes from the environment (`OWNER_EMAIL`) and is never
 * written in code, tests or documents (T2.3).
 *
 * - Provision (T1.1a) refuses when any account already holds `owner`.
 * - Recovery (T1.1b) is for an owner who lost the authenticator and the 8 backup codes at once:
 *   it clears the second factor, ends every session and mails a new link.
 * Both run in one transaction, with the audit entry and the mail, or change nothing.
 *
 * @module
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { recordAudit } from './audit';
import type { Transactional, TxQuery } from './db';
import { canonicalEmail } from './identity';
import { mailResetLink } from './passwordResets';
import { unmatchableHash } from './passwords';

/** Name shown for the owner when `OWNER_FULL_NAME` is not given. */
const DEFAULT_FULL_NAME = 'GrayMan';

/** What the operator asked for, read from the environment. */
interface OwnerRequest {
  /** Canonical e-mail of the owner account. */
  email: string;
  /** Name shown in the account. */
  fullName: string;
  /** True for the emergency recovery, false for the first provision. */
  recover: boolean;
}

/** How a run ended; the script prints it and nothing else about the account. */
export type OwnerOutcome =
  | 'OWNER_PROVISIONED'
  | 'OWNER_ALREADY_EXISTS'
  | 'OWNER_RECOVERY_DISPATCHED'
  | 'OWNER_NOT_FOUND';

/** What both modes need besides the request. */
interface OwnerDeps {
  /** TOTP_ENCRYPTION_KEY: the link's token waits encrypted in the outbox. */
  totpKey: Buffer;
  now: Date;
}

const requestSchema = z.object({
  OWNER_EMAIL: z.email().max(255),
  OWNER_FULL_NAME: z.string().trim().min(1).max(150).default(DEFAULT_FULL_NAME),
  OWNER_RECOVER: z.enum(['0', '1']).default('0'),
});

/**
 * Reads the request of a run (gate E of T1.1a and T1.1b): `OWNER_EMAIL`, the optional
 * `OWNER_FULL_NAME` and the mode, from `OWNER_RECOVER=1` or the `--recover` flag.
 *
 * @param env - Usually `process.env`.
 * @param args - Command-line arguments.
 * @returns The request, or null when the e-mail is missing or malformed (`OWNER_ENV_INVALID`).
 */
export function readOwnerRequest(
  env: Record<string, string | undefined>,
  args: readonly string[]
): OwnerRequest | null {
  const parsed = requestSchema.safeParse(env);
  if (!parsed.success) return null;
  return {
    email: canonicalEmail(parsed.data.OWNER_EMAIL),
    fullName: parsed.data.OWNER_FULL_NAME,
    recover: parsed.data.OWNER_RECOVER === '1' || args.includes('--recover'),
  };
}

/**
 * The account an owner provision works on: the one that already has the e-mail (a buyer who
 * becomes the owner keeps their id and orders), or a new one with an unmatchable hash.
 *
 * @returns The id, and whether the account was created here.
 */
async function ownerAccount(
  tx: TxQuery,
  request: OwnerRequest
): Promise<{ id: string; created: boolean }> {
  const [existing] = await tx.query<{ id: string }>(
    'SELECT id FROM users WHERE email = ? FOR UPDATE',
    [request.email]
  );
  if (existing) {
    await tx.query(
      'UPDATE users SET full_name = ?, is_active = 1 WHERE id = ?',
      [request.fullName, existing.id]
    );
    return { id: existing.id, created: false };
  }
  const id = randomUUID();
  await tx.query(
    'INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)',
    [id, request.email, await unmatchableHash(), request.fullName]
  );
  return { id, created: true };
}

/**
 * Ends every session of an account and forgets every device it remembered. A buyer promoted to
 * owner must not keep a session opened without the authenticator, nor a device that skips the
 * mailed code (T2.4).
 */
async function endAccess(tx: TxQuery, userId: string): Promise<void> {
  await tx.query('DELETE FROM user_sessions WHERE user_id = ?', [userId]);
  await tx.query('DELETE FROM user_trusted_devices WHERE user_id = ?', [
    userId,
  ]);
}

/**
 * First provision of the owner (T1.1a): refuses when an account already holds `owner`;
 * otherwise creates or promotes the account, mails its 15-minute link and audits, atomically.
 *
 * @param db - Database with transactions.
 * @param request - E-mail and name from the environment.
 * @param deps - Key of the outbox and current time.
 * @returns `OWNER_PROVISIONED`, or `OWNER_ALREADY_EXISTS` with nothing changed.
 */
export function provisionOwner(
  db: Transactional,
  request: OwnerRequest,
  deps: OwnerDeps
): Promise<OwnerOutcome> {
  return db.transaction(async (tx) => {
    // The lock makes two concurrent runs see each other: only one finds no owner.
    const owners = await tx.query<{ user_id: string }>(
      "SELECT user_id FROM user_roles WHERE role_id = 'owner' FOR UPDATE"
    );
    if (owners.length > 0) return 'OWNER_ALREADY_EXISTS';
    const { id, created } = await ownerAccount(tx, request);
    await tx.query(
      "INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'owner')",
      [id]
    );
    await endAccess(tx, id);
    await mailResetLink(tx, id, deps.totpKey, deps.now);
    await recordAudit(tx, {
      userId: id,
      action: 'OWNER_PROVISIONED',
      entityType: 'users',
      entityId: id,
      before: null,
      after: { role: 'owner', created },
      ip: null,
    });
    return 'OWNER_PROVISIONED';
  });
}

/**
 * Emergency recovery of the owner (T1.1b): the e-mail must be the one of the account that holds
 * `owner`. Clears its authenticator and backup codes, ends its sessions and remembered devices,
 * spends its open links, mails a new 15-minute link and audits, atomically.
 *
 * @param db - Database with transactions.
 * @param request - E-mail from the environment.
 * @param deps - Key of the outbox and current time.
 * @returns `OWNER_RECOVERY_DISPATCHED`, or `OWNER_NOT_FOUND` with nothing changed.
 */
export function recoverOwner(
  db: Transactional,
  request: OwnerRequest,
  deps: OwnerDeps
): Promise<OwnerOutcome> {
  return db.transaction(async (tx) => {
    const [owner] = await tx.query<{ id: string }>(
      "SELECT u.id FROM users u JOIN user_roles r ON r.user_id = u.id AND r.role_id = 'owner' WHERE u.email = ? FOR UPDATE",
      [request.email]
    );
    if (!owner) return 'OWNER_NOT_FOUND';
    await tx.query('UPDATE users SET is_active = 1 WHERE id = ?', [owner.id]);
    await tx.query('DELETE FROM two_factor_auth WHERE user_id = ?', [owner.id]);
    await tx.query('DELETE FROM two_factor_backup_codes WHERE user_id = ?', [
      owner.id,
    ]);
    await endAccess(tx, owner.id);
    await tx.query(
      'UPDATE password_reset_tokens SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL',
      [deps.now, owner.id]
    );
    await mailResetLink(tx, owner.id, deps.totpKey, deps.now);
    await recordAudit(tx, {
      userId: owner.id,
      action: 'OWNER_RECOVERY_DISPATCHED',
      entityType: 'users',
      entityId: owner.id,
      before: null,
      after: { secondFactorCleared: true, sessionsRevoked: true },
      ip: null,
    });
    return 'OWNER_RECOVERY_DISPATCHED';
  });
}
