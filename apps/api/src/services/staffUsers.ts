/**
 * The staff of the store, as the panel «Usuarios, roles y permisos» manages it (FC 072 F1, K-78):
 * the accounts that hold any role besides `customer`, how they are invited, switched off and given
 * other roles. It replaces the console of administrators of FC 044 and keeps its guarantees.
 *
 * Two people act here, and what each can do is the hierarchy Dueño › Administrador › Vendedor:
 * - the owner may give any role but `owner` and `customer`;
 * - an administrator may only give the roles an owner marked `assignable_by_admin`, and neither
 *   sees nor touches an account that holds a role outside that set (T2.2).
 * An `owner` account is immutable (T2.1). A new account of the staff has no temporary password
 * (T2.4): an unmatchable hash and the 15-minute link of FC 042, queued in the same transaction.
 * Switching an account off, or changing its roles, ends every session and forgets every remembered
 * device in the same transaction (T2.3). Every write audits its before and after, without personal
 * data (T2.5).
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
import { decideStaffMutation, type StaffMutationCode } from './staffGates';

/** Why a write changed nothing; the route answers with it as the problem's detail. */
export type StaffRefusal =
  | 'ACTOR_UNAUTHORIZED'
  | 'TARGET_ROLE_FORBIDDEN'
  | 'ADMIN_CANNOT_ELEVATE_ADMIN'
  | 'OWNER_IMMUTABLE'
  | 'VALIDATION_OR_2FA_FAILED'
  | 'USER_NOT_FOUND'
  | 'ROLE_NOT_FOUND'
  | 'STAFF_ALREADY_EXISTS';

/** Who acts: the session user, as far as the hierarchy needs it. */
interface StaffActor {
  /** The user id. */
  userId: string;
  /** Role slugs of the session. */
  roles: readonly string[];
  /** Whether the authenticator is on (the second factor of the session). */
  totpEnabled: boolean;
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

const toStaffUser = (row: AccountRow): AdminUser => ({
  id: row.id,
  email: row.email,
  fullName: row.full_name,
  roles: row.roles.split(','),
  isActive: Number(row.is_active) === 1,
  totpEnabled: Number(row.totp_enabled) === 1,
  createdAt: row.created_at.toISOString(),
});

/**
 * The accounts of the staff the actor may see: the owner sees all of them, owners first and then
 * administrators; an administrator only sees the accounts whose roles an administrator may give,
 * so owners and administrators stay hidden (T2.2).
 *
 * @param db - Database port.
 * @param asOwner - True when the actor is the owner.
 * @returns The accounts, each with all its roles.
 */
export async function listStaff(
  db: TxQuery,
  asOwner: boolean
): Promise<AdminUser[]> {
  const rows = asOwner
    ? await db.query<AccountRow>(
        "SELECT u.id, u.email, u.full_name, u.is_active, u.created_at, GROUP_CONCAT(ur.role_id ORDER BY ur.role_id) AS roles, COALESCE(MAX(t.is_totp_enabled), 0) AS totp_enabled FROM users u JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN two_factor_auth t ON t.user_id = u.id GROUP BY u.id, u.email, u.full_name, u.is_active, u.created_at HAVING SUM(ur.role_id <> 'customer') > 0 ORDER BY SUM(ur.role_id = 'owner') DESC, SUM(ur.role_id = 'admin') DESC, u.email"
      )
    : await db.query<AccountRow>(
        "SELECT u.id, u.email, u.full_name, u.is_active, u.created_at, GROUP_CONCAT(ur.role_id ORDER BY ur.role_id) AS roles, COALESCE(MAX(t.is_totp_enabled), 0) AS totp_enabled FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id LEFT JOIN two_factor_auth t ON t.user_id = u.id GROUP BY u.id, u.email, u.full_name, u.is_active, u.created_at HAVING SUM(ur.role_id <> 'customer') > 0 AND SUM(ur.role_id <> 'customer' AND r.assignable_by_admin = 0) = 0 ORDER BY u.email"
      );
  return rows.map(toStaffUser);
}

/** One account with its roles, as the panel shows it after a write. */
async function accountOf(tx: TxQuery, id: string): Promise<AdminUser> {
  const [row] = await tx.query<AccountRow>(
    'SELECT u.id, u.email, u.full_name, u.is_active, u.created_at, GROUP_CONCAT(ur.role_id ORDER BY ur.role_id) AS roles, COALESCE(MAX(t.is_totp_enabled), 0) AS totp_enabled FROM users u JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN two_factor_auth t ON t.user_id = u.id WHERE u.id = ? GROUP BY u.id, u.email, u.full_name, u.is_active, u.created_at',
    [id]
  );
  return toStaffUser(row);
}

/** The roles of an account, locked until the transaction ends; empty for an unknown id. */
async function lockedRoles(tx: TxQuery, userId: string): Promise<string[]> {
  const rows = await tx.query<{ role_id: string }>(
    'SELECT role_id FROM user_roles WHERE user_id = ? FOR UPDATE',
    [userId]
  );
  return rows.map((row) => row.role_id);
}

/** What the actor may do with the roles it names: they exist, are active and are within its authority. */
interface RoleCheck {
  /** Every role asked exists and is active. */
  found: boolean;
  /** Every role asked is within the authority of the actor (T). */
  permitted: boolean;
}

/** The roles an account cannot hold through this panel, whoever acts: the owner and the buyer. */
const OUT_OF_BAND = new Set(['owner', 'customer']);

async function checkRoles(
  tx: TxQuery,
  requested: readonly string[],
  asOwner: boolean
): Promise<RoleCheck> {
  const wanted = [...new Set(requested)];
  const rows = await tx.query<{
    id: string;
    is_active: number;
    assignable_by_admin: number;
  }>('SELECT id, is_active, assignable_by_admin FROM roles WHERE id IN (?)', [
    wanted,
  ]);
  const active = rows.filter((row) => Number(row.is_active) === 1);
  return {
    found: active.length === wanted.length,
    permitted: asOwner
      ? wanted.every((id) => !OUT_OF_BAND.has(id))
      : active.every((row) => Number(row.assignable_by_admin) === 1),
  };
}

/** The refusal a closed gate gives, which names T2.2 when an administrator reached for more. */
function refusalOf(
  code: Exclude<StaffMutationCode, 'MUTATION_PERMITTED_200'>,
  asOwner: boolean
): StaffRefusal {
  if (code === 'ACTOR_UNAUTHORIZED_401') return 'ACTOR_UNAUTHORIZED';
  if (code === 'VALIDATION_OR_2FA_FAILED_400')
    return 'VALIDATION_OR_2FA_FAILED';
  return asOwner ? 'TARGET_ROLE_FORBIDDEN' : 'ADMIN_CANNOT_ELEVATE_ADMIN';
}

/** Whether the account holds any role besides `customer`. */
const isStaff = (roles: readonly string[]) =>
  roles.some((role) => role !== 'customer');

/**
 * Brings a person into the staff (T1.1): a new account born with an unmatchable hash, or an
 * existing buyer, switched on and with its access ended so no session opened without the
 * authenticator inherits the roles. Either way it mails the 15-minute link and audits.
 *
 * @param tx - Transaction of the request.
 * @param input - Canonical e-mail, name and roles, the outbox key and the clock.
 * @param actor - Who acts.
 * @returns The account, or why nothing changed.
 */
export async function createStaff(
  tx: TxQuery,
  input: {
    email: string;
    fullName: string;
    roles: readonly string[];
    totpKey: Buffer;
    now: Date;
  },
  actor: StaffActor
): Promise<AdminUser | StaffRefusal> {
  const asOwner = actor.roles.includes('owner');
  const privileged = asOwner || actor.roles.includes('admin');
  const check = await checkRoles(tx, input.roles, asOwner);
  if (privileged && !check.found) return 'ROLE_NOT_FOUND';
  const verdict = decideStaffMutation({
    privileged,
    rolePermitted: check.permitted,
    valid: actor.totpEnabled,
  });
  if (verdict !== 'MUTATION_PERMITTED_200') return refusalOf(verdict, asOwner);
  const [existing] = await tx.query<{ id: string }>(
    'SELECT id FROM users WHERE email = ? FOR UPDATE',
    [input.email]
  );
  const id = existing?.id ?? randomUUID();
  if (existing) {
    const held = await lockedRoles(tx, id);
    if (held.includes('owner')) return 'OWNER_IMMUTABLE';
    if (isStaff(held)) return 'STAFF_ALREADY_EXISTS';
    await tx.query('UPDATE users SET is_active = 1 WHERE id = ?', [id]);
    await revokeAccess(tx, id);
  } else {
    await tx.query(
      'INSERT INTO users (id, email, password_hash, full_name) VALUES (?, ?, ?, ?)',
      [id, input.email, await unmatchableHash(), input.fullName]
    );
  }
  const wanted = [...new Set(['customer', ...input.roles])];
  await tx.query('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES ?', [
    wanted.map((role) => [id, role]),
  ]);
  await mailResetLink(tx, id, input.totpKey, input.now);
  await recordAudit(tx, {
    userId: actor.userId,
    action: 'STAFF_CREATED',
    entityType: 'users',
    entityId: id,
    before: null,
    after: { roles: wanted, created: !existing },
    ip: actor.ip,
  });
  return accountOf(tx, id);
}

/**
 * Switches an account of the staff on or off, or replaces its roles (T1.1). Switching off or
 * changing the roles ends the sessions and the remembered devices in the same transaction (T2.3);
 * the account stays a buyer. The owner is never reached (T2.1), and an administrator cannot reach
 * an administrator, itself included (T2.2).
 *
 * @param tx - Transaction of the request.
 * @param input - The account and what to change.
 * @param actor - Who acts.
 * @returns The account, or why nothing changed.
 */
export async function updateStaff(
  tx: TxQuery,
  input: { id: string; isActive?: boolean; roles?: readonly string[] },
  actor: StaffActor
): Promise<AdminUser | StaffRefusal> {
  const asOwner = actor.roles.includes('owner');
  const privileged = asOwner || actor.roles.includes('admin');
  const held = await lockedRoles(tx, input.id);
  const check = input.roles
    ? await checkRoles(tx, input.roles, asOwner)
    : { found: true, permitted: true };
  if (privileged && !check.found) return 'ROLE_NOT_FOUND';
  const verdict = decideStaffMutation({
    privileged,
    rolePermitted: check.permitted,
    valid: actor.totpEnabled,
  });
  if (verdict !== 'MUTATION_PERMITTED_200') return refusalOf(verdict, asOwner);
  if (held.includes('owner')) return 'OWNER_IMMUTABLE';
  if (!isStaff(held)) return 'USER_NOT_FOUND';
  if (!asOwner) {
    const own = await checkRoles(
      tx,
      held.filter((role) => role !== 'customer'),
      false
    );
    if (!own.permitted) return 'ADMIN_CANNOT_ELEVATE_ADMIN';
  }
  const before = await accountOf(tx, input.id);
  if (input.isActive !== undefined) {
    await tx.query('UPDATE users SET is_active = ? WHERE id = ?', [
      input.isActive ? 1 : 0,
      input.id,
    ]);
  }
  if (input.roles) {
    await tx.query(
      "DELETE FROM user_roles WHERE user_id = ? AND role_id <> 'customer'",
      [input.id]
    );
    await tx.query(
      'INSERT IGNORE INTO user_roles (user_id, role_id) VALUES ?',
      [[...new Set(input.roles)].map((role) => [input.id, role])]
    );
  }
  if (input.isActive === false || input.roles) {
    await revokeAccess(tx, input.id);
  }
  const after = await accountOf(tx, input.id);
  await recordAudit(tx, {
    userId: actor.userId,
    action: 'STAFF_UPDATED',
    entityType: 'users',
    entityId: input.id,
    before: { isActive: before.isActive, roles: before.roles },
    after: { isActive: after.isActive, roles: after.roles },
    ip: actor.ip,
  });
  return after;
}
