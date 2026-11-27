/**
 * The RBAC permission catalog (FC 028, 143_AN B1): the permissions migration 004 seeds, plus
 * `shipping:manage` of migration 014 (FC 061) and `orders:manage` of migration 016 (FC 068), the three `returns:*` of migration 017 (FC 071) and
 * `roles:manage` and `sellers:manage` of migration 018 (FC 072) and the three `pos:*` of migration
 * 020 (FC 076), as the API names them. Routes declare one of these in apps/api/src/contract.ts, and a test reads
 * migration 004 to prove this list and the database never drift apart.
 *
 * @module
 */

/** Every permission a route may require, besides `public`. */
export const PERMISSIONS = [
  'account:self',
  'orders:read',
  'catalog:write',
  'users:manage',
  'audit:read',
  'shipping:manage',
  'orders:manage',
  'returns:view',
  'returns:prepare',
  'returns:confirm',
  'roles:manage',
  'sellers:manage',
  'pos:sell',
  'pos:shift',
  'pos:supervisor',
] as const;

/** One permission of the catalog. */
export type Permission = (typeof PERMISSIONS)[number];

/** Roles whose users must hold TOTP (143_AN B2): every role but `customer`. */
export function isPrivileged(roles: readonly string[]): boolean {
  return roles.some((role) => role !== 'customer');
}
