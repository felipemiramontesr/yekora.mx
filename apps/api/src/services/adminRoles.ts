/**
 * The roles and the matrix of permissions, as the owner edits them (FC 072 F1, K-78 and K-58).
 * A permission is a unit of the code (the catalog of `lib/permissions.ts`); a role is a row of the
 * database that groups some of them, so the owner can make roles of support without a deploy. The
 * session reads `role_permissions` on every request, so an edit takes effect at once.
 *
 * Only the owner edits, and only a role that is not of the system (T1.2). The matrix keeps five
 * invariants (T2.7): `roles:manage` belongs to the owner alone, `users:manage` to the owner and the
 * administrator, `account:self` is in every role, nothing outside the catalog is assigned, and the
 * row of the owner, which holds every permission, is never edited. Every write audits its before
 * and after.
 *
 * @module
 */
import type { RoleView } from '../../../../lib/account/staffTypes';
import { RESERVED_ROLE_IDS } from '../../../../lib/account/staffTypes';
import { PERMISSIONS } from '../lib/permissions';
import { recordAudit } from './audit';
import type { TxQuery } from './db';
import { decideRoleMutation, type RoleMutationCode } from './staffGates';

/** Why a write changed nothing; the route answers with it as the problem's detail. */
export type RoleRefusal =
  | 'OWNER_ONLY_FORBIDDEN'
  | 'SYSTEM_ROLE_PROTECTED'
  | 'TWO_FACTOR_REQUIRED'
  | 'ROLE_NOT_FOUND'
  | 'ROLE_ALREADY_EXISTS'
  | 'ROLE_ID_RESERVED'
  | 'MATRIX_INVARIANT_VIOLATED'
  | 'ROLE_INVARIANT_VIOLATED';

/** Who acts: the session user, as far as the rule of the owner needs it. */
interface RoleActor {
  /** The user id. */
  userId: string;
  /** Role slugs of the session. */
  roles: readonly string[];
  /** Permission slugs of the session. */
  permissions: readonly string[];
  /** Whether the authenticator is on (the second factor of the session). */
  totpEnabled: boolean;
  /** Client address. */
  ip: string | null;
}

/** The refusal a closed gate gives. */
function refusalOf(
  code: Exclude<RoleMutationCode, 'ROLE_MUTATION_PERMITTED_200'>
): RoleRefusal {
  if (code === 'OWNER_ONLY_FORBIDDEN_403') return 'OWNER_ONLY_FORBIDDEN';
  return code === 'SYSTEM_ROLE_PROTECTED_403'
    ? 'SYSTEM_ROLE_PROTECTED'
    : 'TWO_FACTOR_REQUIRED';
}

/** The catalog of permissions the matrix is made of, in alphabetical order. */
const CATALOG: readonly string[] = [...PERMISSIONS].sort((first, second) =>
  first.localeCompare(second)
);
const CATALOG_SET: ReadonlySet<string> = new Set(CATALOG);

/** A flag as MySQL stores it, or null to leave a column as it is. */
const flag = (value: boolean | undefined) =>
  value === undefined ? null : Number(value);

/**
 * T2.7: whether a matrix for `roleId` breaks an invariant.
 *
 * @param roleId - The role the matrix is for.
 * @param permissions - The permissions asked.
 * @returns True when it names a permission outside the catalog, gives `roles:manage`, gives
 *   `users:manage` to a role that is not `admin`, or leaves out `account:self`.
 */
function breaksMatrix(roleId: string, permissions: readonly string[]): boolean {
  return (
    !permissions.includes('account:self') ||
    permissions.includes('roles:manage') ||
    (permissions.includes('users:manage') && roleId !== 'admin') ||
    permissions.some((permission) => !CATALOG_SET.has(permission))
  );
}

/** A role row with its permissions joined by commas. */
interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  is_active: number;
  is_system: number;
  assignable_by_admin: number;
  permissions: string | null;
}

const toRoleView = (row: RoleRow): RoleView => ({
  id: row.id,
  name: row.name,
  description: row.description,
  isActive: Number(row.is_active) === 1,
  isSystem: Number(row.is_system) === 1,
  assignableByAdmin: Number(row.assignable_by_admin) === 1,
  permissions: row.permissions === null ? [] : row.permissions.split(','),
});

/**
 * The roles with their permissions: the system ones first, then by slug.
 *
 * @param db - Database port.
 * @returns The roles and the catalog of permissions.
 */
export async function listRoles(
  db: TxQuery
): Promise<{ items: RoleView[]; catalog: string[] }> {
  const rows = await db.query<RoleRow>(
    'SELECT r.id, r.name, r.description, r.is_active, r.is_system, r.assignable_by_admin, GROUP_CONCAT(rp.permission_id ORDER BY rp.permission_id) AS permissions FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id GROUP BY r.id, r.name, r.description, r.is_active, r.is_system, r.assignable_by_admin ORDER BY r.is_system DESC, r.id'
  );
  return { items: rows.map(toRoleView), catalog: [...CATALOG] };
}

/** One role with its permissions, as the panel shows it after a write. */
async function roleOf(tx: TxQuery, id: string): Promise<RoleView> {
  const [row] = await tx.query<RoleRow>(
    'SELECT r.id, r.name, r.description, r.is_active, r.is_system, r.assignable_by_admin, GROUP_CONCAT(rp.permission_id ORDER BY rp.permission_id) AS permissions FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id WHERE r.id = ? GROUP BY r.id, r.name, r.description, r.is_active, r.is_system, r.assignable_by_admin',
    [id]
  );
  return toRoleView(row);
}

/** The gate for a write that targets `notSystem`, with who acts. */
function gate(actor: RoleActor, notSystem: boolean): RoleMutationCode {
  return decideRoleMutation({
    owner: actor.roles.includes('owner'),
    manager: actor.permissions.includes('roles:manage'),
    notSystem,
    valid: actor.totpEnabled,
  });
}

/** Replaces the permissions of a role, in the caller's transaction. */
async function setPermissions(
  tx: TxQuery,
  roleId: string,
  permissions: readonly string[]
): Promise<void> {
  await tx.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
  await tx.query(
    'INSERT INTO role_permissions (role_id, permission_id) VALUES ?',
    [[...new Set(permissions)].map((permission) => [roleId, permission])]
  );
}

/**
 * Creates a role of support (T1.2): its slug is valid and not reserved, and its matrix keeps the
 * invariants of T2.7.
 *
 * @param tx - Transaction of the request.
 * @param input - Slug, name, description, permissions and whether an administrator may give it.
 * @param actor - Who acts.
 * @returns The role, or why nothing changed.
 */
export async function createRole(
  tx: TxQuery,
  input: {
    id: string;
    name: string;
    description?: string;
    permissions: readonly string[];
    assignableByAdmin: boolean;
  },
  actor: RoleActor
): Promise<RoleView | RoleRefusal> {
  const verdict = gate(actor, true);
  if (verdict !== 'ROLE_MUTATION_PERMITTED_200') return refusalOf(verdict);
  if (RESERVED_ROLE_IDS.has(input.id)) return 'ROLE_ID_RESERVED';
  if (breaksMatrix(input.id, input.permissions))
    return 'MATRIX_INVARIANT_VIOLATED';
  const [taken] = await tx.query<{ id: string }>(
    'SELECT id FROM roles WHERE id = ? FOR UPDATE',
    [input.id]
  );
  if (taken !== undefined) return 'ROLE_ALREADY_EXISTS';
  await tx.query(
    'INSERT INTO roles (id, name, description, is_active, is_system, assignable_by_admin) VALUES (?, ?, ?, 1, 0, ?)',
    [
      input.id,
      input.name,
      input.description ?? null,
      Number(input.assignableByAdmin),
    ]
  );
  await setPermissions(tx, input.id, input.permissions);
  const created = await roleOf(tx, input.id);
  await recordAudit(tx, {
    userId: actor.userId,
    action: 'ROLE_CREATED',
    entityType: 'roles',
    entityId: input.id,
    before: null,
    after: {
      assignableByAdmin: created.assignableByAdmin,
      permissions: created.permissions,
    },
    ip: actor.ip,
  });
  return created;
}

/**
 * Edits a role: its name and description, whether it is active, whether an administrator may give
 * it, and its matrix (T1.2, T2.7). A role of the system is protected. The administrator stays out
 * of its own gift: it cannot become assignable by an administrator and cannot be switched off,
 * since either would lock the administrators out or let them raise themselves.
 *
 * @param tx - Transaction of the request.
 * @param id - Slug of the role.
 * @param input - What to change.
 * @param actor - Who acts.
 * @returns The role, or why nothing changed.
 */
export async function patchRole(
  tx: TxQuery,
  id: string,
  input: {
    name?: string;
    description?: string;
    isActive?: boolean;
    assignableByAdmin?: boolean;
    permissions?: readonly string[];
  },
  actor: RoleActor
): Promise<RoleView | RoleRefusal> {
  const closed = gate(actor, true);
  if (closed === 'OWNER_ONLY_FORBIDDEN_403') return refusalOf(closed);
  const [target] = await tx.query<{ is_system: number }>(
    'SELECT is_system FROM roles WHERE id = ? FOR UPDATE',
    [id]
  );
  if (target === undefined) return 'ROLE_NOT_FOUND';
  const verdict = gate(actor, Number(target.is_system) === 0);
  if (verdict !== 'ROLE_MUTATION_PERMITTED_200') return refusalOf(verdict);
  if (
    id === 'admin' &&
    (input.assignableByAdmin === true || input.isActive === false)
  ) {
    return 'ROLE_INVARIANT_VIOLATED';
  }
  if (input.permissions && breaksMatrix(id, input.permissions)) {
    return 'MATRIX_INVARIANT_VIOLATED';
  }
  const before = await roleOf(tx, id);
  await tx.query(
    'UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description), is_active = COALESCE(?, is_active), assignable_by_admin = COALESCE(?, assignable_by_admin) WHERE id = ?',
    [
      input.name ?? null,
      input.description ?? null,
      flag(input.isActive),
      flag(input.assignableByAdmin),
      id,
    ]
  );
  if (input.permissions) await setPermissions(tx, id, input.permissions);
  const after = await roleOf(tx, id);
  await recordAudit(tx, {
    userId: actor.userId,
    action: 'ROLE_UPDATED',
    entityType: 'roles',
    entityId: id,
    before: {
      isActive: before.isActive,
      assignableByAdmin: before.assignableByAdmin,
      permissions: before.permissions,
    },
    after: {
      isActive: after.isActive,
      assignableByAdmin: after.assignableByAdmin,
      permissions: after.permissions,
    },
    ip: actor.ip,
  });
  return after;
}
