/**
 * The sections of the account area a person may open (FC 044 T1.4, FC 047): one place, read by
 * the area itself and by the account menu of the header, so the two can never disagree. The API
 * refuses what a person may not open anyway; this only decides what is offered.
 *
 * @module
 */
import type { MeResponse } from './authTypes';

/** A section of the area, in the order they are offered. */
type AccountSection = 'orders' | 'panel' | 'catalog' | 'admins';

/** The permission that opens the panel's orders. */
const PANEL_PERMISSION = 'orders:read';

/** The permission that opens the catalog console (FC 029 F3). */
const CATALOG_PERMISSION = 'catalog:write';

/** The role that opens the administrators console (FC 044 T1.4): no permission grants it. */
const OWNER_ROLE = 'owner';

/** Who is offered each section: the buyer's orders always; the rest by permission or role. */
const ACCESS: Readonly<
  Record<
    AccountSection,
    (user: Pick<MeResponse, 'roles' | 'permissions'>) => boolean
  >
> = {
  orders: () => true,
  panel: (user) => user.permissions.includes(PANEL_PERMISSION),
  catalog: (user) => user.permissions.includes(CATALOG_PERMISSION),
  admins: (user) => user.roles.includes(OWNER_ROLE),
};

/** Every section, in the order they are offered. */
const ORDER: readonly AccountSection[] = [
  'orders',
  'panel',
  'catalog',
  'admins',
];

/**
 * The sections an account is offered.
 *
 * @param user - Its roles and permissions.
 * @returns The sections, in order; «orders» is always the first.
 */
export function sectionsOf(
  user: Pick<MeResponse, 'roles' | 'permissions'>
): AccountSection[] {
  return ORDER.filter((section) => ACCESS[section](user));
}

/**
 * Whether the account is the owner's.
 *
 * @param user - Its roles.
 */
export function isOwner(user: Pick<MeResponse, 'roles'>): boolean {
  return user.roles.includes(OWNER_ROLE);
}
