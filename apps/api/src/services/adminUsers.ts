/**
 * Administrators, as the owner manages them (FC 044 F1, T1.2, T1.3, T2.1, T2.2, T2.5): the
 * accounts that hold `owner` or `admin`, the grant of `admin` and its withdrawal.
 *
 * - An `owner` account is immutable here (T2.1): any write that targets one is refused, so the
 *   store always keeps its owner. The role is granted only out of band (ownerProvision.ts).
 * - A new administrator gets no temporary password (T2.2): an unmatchable hash and the
 *   15-minute reset link of FC 042, queued in the same transaction.
 * - Switching an administrator off or withdrawing the role ends every session and forgets every
 *   remembered device of the account, in the same transaction (T2.5). So does granting the
 *   role to an existing buyer: a session opened without the authenticator must not inherit it.
 * Every write records its `audit_log` entry in the caller's transaction, without personal data.
 *
 * @module
 */
import { randomUUID } from 'node:crypto';
import type { AdminUser } from '../../../../lib/account/adminUserTypes';
import { recordAudit } from './audit';
import type { TxQuery } from './db';
import { revokeAccess } from './identity';
import { mailResetLink } from './passwordResets';
import { unmatchableHash } from './passwords';

/** Why a write changed nothing; the route answers with it as the problem's detail. */
export type AdminRefusal =
  'OWNER_IMMUTABLE' | 'ADMIN_ALREADY_EXISTS' | 'ADMIN_NOT_FOUND';

/** Who acts, for the audit entry. */
interface Actor {
  /** The owner's user id. */
  userId: string;
  /** Client address. */
  ip: string | null;
}

/** An account row with its roles joined by commas. */
interface AccountRow {
  id: string;
  email: string;
  full_name: string;
  is_active: number;
  created_at: Date;
  roles: string;
  totp_enabled: number;
}

const toAdminUser = (row: AccountRow): AdminUser => ({
  id: row.id,
  email: row.email,
  fullName: row.full_name,
  roles: row.roles.split(','),
  isActive: Number(row.is_active) === 1,
  totpEnabled: Number(row.totp_enabled) === 1,
  createdAt: row.created_at.toISOString(),
});

/**
 * Every account that holds `owner` or `admin`: owners first, then by e-mail.
 *
 * @param db - Database port.
 * @returns The accounts, each with all its roles.
 */
export async function listAdmins(db: TxQuery): Promise<AdminUser[]> {
  const rows = await db.query<AccountRow>(
    "SELECT u.id, u.email, u.full_name, u.is_active, u.created_at, GROUP_CONCAT(ur.role_id ORDER BY ur.role_id) AS roles, COALESCE(MAX(t.is_totp_enabled), 0) AS totp_enabled FROM users u JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN two_factor_auth t ON t.user_id = u.id GROUP BY u.id, u.email, u.full_name, u.is_active, u.created_at HAVING SUM(ur.role_id IN ('owner', 'admin')) > 0 ORDER BY SUM(ur.role_id = 'owner') DESC, u.email"
  );
  return rows.map(toAdminUser);
}

/** One account with its roles, as the console shows it after a write. */
async function accountOf(tx: TxQuery, id: string): Promise<AdminUser> {
  const [row] = await tx.query<AccountRow>(
    'SELECT u.id, u.email, u.full_name, u.is_active, u.created_at, GROUP_CONCAT(ur.role_id ORDER BY ur.role_id) AS roles, COALESCE(MAX(t.is_totp_enabled), 0) AS totp_enabled FROM users u JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN two_factor_auth t ON t.user_id = u.id WHERE u.id = ? GROUP BY u.id, u.email, u.full_name, u.is_active, u.created_at',
    [id]
  );
  return toAdminUser(row);
}

/** The roles of an account, locked until the transaction ends; empty for an unknown id. */
async function lockedRoles(tx: TxQuery, userId: string): Promise<string[]> {
  const rows = await tx.query<{ role_id: string }>(
    'SELECT role_id FROM user_roles WHERE user_id = ? FOR UPDATE',
    [userId]
  );
  return rows.map((row) => row.role_id);
}

/**
 * Grants `admin` (T1.2): to the account that already has the e-mail, switched on and with its
 * access ended, or to a new one born with an unmatchable hash. Either way it mails the
 * 15-minute link and audits, in the caller's transaction.
 *
 * @param tx - Transaction of the request.
 * @param input - Canonical e-mail and name of the administrator, the outbox key and the clock.
 * @param actor - The owner who acts.
 * @returns The account, or why nothing changed (target is an owner, or already an admin).
 */
export async function createAdmin(
  tx: TxQuery,
  input: { email: string; fullName: string; totpKey: Buffer; now: Date },
  actor: Actor
): Promise<AdminUser | AdminRefusal> {
  const [existing] = await tx.query<{ id: string }>(
    'SELECT id FROM users WHERE email = ? FOR UPDATE',
    [input.email]
  );
  const id = existing?.id ?? randomUUID();
  if (existing) {
    const roles = await lockedRoles(tx, id);
    if (roles.includes('owner')) return 'OWNER_IMMUTABLE';
    if (roles.includes('admin')) return 'ADMIN_ALREADY_EXISTS';
    await tx.query('UPDATE users SET is_active = 1 WHERE id = ?', [id]);
    await revokeAccess(tx, id);
  } else {
    await tx.query(
      'INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)',
      [id, input.email, await unmatchableHash(), input.fullName]
    );
  }
  await tx.query(
    "INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'customer'), (?, 'admin')",
    [id, id]
  );
  await mailResetLink(tx, id, input.totpKey, input.now);
  await recordAudit(tx, {
    userId: actor.userId,
    action: 'ADMIN_CREATED',
    entityType: 'users',
    entityId: id,
    before: null,
    after: { role: 'admin', created: !existing },
    ip: actor.ip,
  });
  return accountOf(tx, id);
}

/**
 * Switches an administrator on or off, or withdraws its `admin` role (T1.3). Switching off or
 * withdrawing ends the account's sessions and remembered devices in the same transaction
 * (T2.5); a withdrawn administrator stays a buyer.
 *
 * @param tx - Transaction of the request.
 * @param input - The account and what to change.
 * @param actor - The owner who acts.
 * @returns The account, or why nothing changed (target is an owner, or is not an admin).
 */
export async function updateAdmin(
  tx: TxQuery,
  input: { id: string; isActive?: boolean; revokeAdmin?: boolean },
  actor: Actor
): Promise<AdminUser | AdminRefusal> {
  const roles = await lockedRoles(tx, input.id);
  if (roles.includes('owner')) return 'OWNER_IMMUTABLE';
  if (!roles.includes('admin')) return 'ADMIN_NOT_FOUND';
  const before = await accountOf(tx, input.id);
  if (input.isActive !== undefined) {
    await tx.query('UPDATE users SET is_active = ? WHERE id = ?', [
      input.isActive ? 1 : 0,
      input.id,
    ]);
  }
  if (input.revokeAdmin === true) {
    await tx.query(
      "DELETE FROM user_roles WHERE user_id = ? AND role_id = 'admin'",
      [input.id]
    );
    await tx.query(
      "INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'customer')",
      [input.id]
    );
  }
  if (input.isActive === false || input.revokeAdmin === true) {
    await revokeAccess(tx, input.id);
  }
  const after = await accountOf(tx, input.id);
  await recordAudit(tx, {
    userId: actor.userId,
    action: 'ADMIN_UPDATED',
    entityType: 'users',
    entityId: input.id,
    before: { isActive: before.isActive, roles: before.roles },
    after: { isActive: after.isActive, roles: after.roles },
    ip: actor.ip,
  });
  return after;
}
