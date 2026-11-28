/**
 * The sections of the account area a person may open (FC 044 T1.4, FC 047, FC 052): one place, read
 * by the area itself and by the account menu of the header, so the two can never disagree. The API
 * refuses what a person may not open anyway; this only decides what is offered.
 *
 * The menu offers four entries: «Mis pedidos», «Mi información», «Métodos de pago» (FC 054) and, to whoever may open at least
 * one console, «Administración», a page with a card for each console the account may open. The
 * consoles themselves (the panel's orders, the catalog, the shipping and the users) are no longer entries
 * of the menu, but the area still opens them by their own address.
 *
 * @module
 */
import type { MeResponse } from './authTypes';

/** A section of the area. */
type AccountSection =
  | 'orders'
  | 'profile'
  | 'payment-methods'
  | 'admin'
  | 'panel'
  | 'catalog'
  | 'users'
  | 'returns'
  | 'pos'
  | 'fiscal'
  | 'invoicing'
  | 'shipping';

/** The permission that opens the panel's orders. */
const PANEL_PERMISSION = 'orders:read';

/** The permission that opens the catalog console (FC 029 F3). */
const CATALOG_PERMISSION = 'catalog:write';

/** The permission that opens the shipping console (FC 061). */
const SHIPPING_PERMISSION = 'shipping:manage';

/** The permission that opens the board of returns (FC 073). */
const RETURNS_PERMISSION = 'returns:view';

/** The permissions that open the point of sale (FC 076): selling or running the till. */
const POS_PERMISSIONS = new Set(['pos:sell', 'pos:shift']);

/** The permission that opens the queue of invoice requests (FC 077). */
const INVOICING_PERMISSION = 'invoices:read';

/** The role of the owner (FC 044 T2.1): the panel of users shows it everything and protects it. */
const OWNER_ROLE = 'owner';

/** The permission that opens the panel of users and roles (FC 072): the owner and the administrator hold it. */
const USERS_PERMISSION = 'sellers:manage';

/** What the rule reads of an account. */
type Who = Pick<MeResponse, 'roles' | 'permissions'>;

/** Who may open each section: the buyer's orders and data always; the rest by permission or role. */
const ACCESS: Readonly<Record<AccountSection, (user: Who) => boolean>> = {
  orders: () => true,
  profile: () => true,
  'payment-methods': () => true,
  fiscal: () => true,
  admin: (user) =>
    ACCESS.panel(user) ||
    ACCESS.catalog(user) ||
    ACCESS.shipping(user) ||
    ACCESS.users(user) ||
    ACCESS.returns(user) ||
    ACCESS.invoicing(user) ||
    ACCESS.pos(user),
  panel: (user) => user.permissions.includes(PANEL_PERMISSION),
  catalog: (user) => user.permissions.includes(CATALOG_PERMISSION),
  users: (user) => user.permissions.includes(USERS_PERMISSION),
  returns: (user) => user.permissions.includes(RETURNS_PERMISSION),
  invoicing: (user) => user.permissions.includes(INVOICING_PERMISSION),
  pos: (user) =>
    user.permissions.some((permission) => POS_PERMISSIONS.has(permission)),
  shipping: (user) => user.permissions.includes(SHIPPING_PERMISSION),
};

/** An entry of the account menu. */
type MenuSection = Extract<
  AccountSection,
  'orders' | 'profile' | 'payment-methods' | 'admin'
>;

/** The entries of the account menu, in order. */
const MENU: readonly MenuSection[] = [
  'orders',
  'profile',
  'payment-methods',
  'admin',
];

/**
 * The entries the account menu offers.
 *
 * @param user - Its roles and permissions.
 * @returns «Mis pedidos», «Mi información» and «Métodos de pago» always, and «Administración» when the account may open
 *   at least one console (FC 052 T1.1: `orders:read` ∨ `catalog:write` ∨ the owner role).
 */
export function sectionsOf(user: Who): MenuSection[] {
  return MENU.filter((section) => ACCESS[section](user));
}

/**
 * Whether the area opens a section for an account.
 *
 * @param user - Its roles and permissions.
 * @param section - The section.
 * @returns True when the account may open it.
 */
export function canOpen(user: Who, section: AccountSection): boolean {
  return ACCESS[section](user);
}

/** A card of the administration hub. */
export interface AdminCard {
  /** Which text it reads from `account.adminHub.cards`. */
  key:
    | 'orders'
    | 'products'
    | 'shipping'
    | 'users'
    | 'returns'
    | 'pos'
    | 'invoices';
  /** The console it opens. */
  tab:
    | 'panel'
    | 'catalog'
    | 'shipping'
    | 'users'
    | 'returns'
    | 'invoicing'
    | 'pos';
  /** No card opens a tab of its console: «Productos» opens the centre of the catalog (FC 078). */
  section: null;
}

/** The cards, in order, each with the section that grants it. */
const CARDS: readonly (AdminCard & { grantedBy: AccountSection })[] = [
  { key: 'orders', tab: 'panel', section: null, grantedBy: 'panel' },
  { key: 'pos', tab: 'pos', section: null, grantedBy: 'pos' },
  { key: 'products', tab: 'catalog', section: null, grantedBy: 'catalog' },
  { key: 'shipping', tab: 'shipping', section: null, grantedBy: 'shipping' },
  { key: 'returns', tab: 'returns', section: null, grantedBy: 'returns' },
  {
    key: 'invoices',
    tab: 'invoicing',
    section: null,
    grantedBy: 'invoicing',
  },
  { key: 'users', tab: 'users', section: null, grantedBy: 'users' },
];

/**
 * The cards of the administration hub an account is shown (FC 052 T2.4): each one if and only if
 * the account holds its own privilege: «Pedidos» with `orders:read`, «Productos» (the whole catalog, FC 078)
 * with `catalog:write`, «Envíos» with `shipping:manage`, «Devoluciones» with `returns:view`, «Facturación» with `invoices:read`, «Usuarios, roles y permisos» with `sellers:manage`.
 *
 * @param user - Its roles and permissions.
 * @returns The cards, in order.
 */
export function adminCardsOf(user: Who): AdminCard[] {
  return CARDS.filter((card) => ACCESS[card.grantedBy](user)).map(
    ({ key, tab, section }) => ({ key, tab, section })
  );
}

/**
 * Whether the account is the owner's.
 *
 * @param user - Its roles.
 */
export function isOwner(user: Pick<MeResponse, 'roles'>): boolean {
  return user.roles.includes(OWNER_ROLE);
}
