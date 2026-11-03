/**
 * The RBAC permission catalog (FC 028, 143_AN B1): the permissions migration 004 seeds, as the
 * API names them. Routes declare one of these in apps/api/src/contract.ts, and a test reads
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
] as const;

/** One permission of the catalog. */
export type Permission = (typeof PERMISSIONS)[number];

/** Roles whose users must hold TOTP (143_AN B2): every role but `customer`. */
export function isPrivileged(roles: readonly string[]): boolean {
  return roles.some((role) => role !== 'customer');
}
