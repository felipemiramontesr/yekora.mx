/**
 * Paths inside the account area (FC 028 F2, T2.6c). The area is one static page per language
 * (`/cuenta/`, `/en/account/`); Apache answers every sub-path with that page
 * (public/.htaccess), and the page reads the path to open the right view. The sub-paths are
 * the same in both languages, so the language switcher keeps the open order:
 *
 * - `{area}` my orders · `{area}{order}/` one of them;
 * - `{area}datos/` the data of the account: its profile and its delivery addresses (FC 051);
 * - `{area}metodos-pago/` the cards the account keeps at Stripe (FC 054);
 * - `{area}panel/` every order (staff) · `{area}panel/{order}/` one of them;
 * - `{area}administracion/` the administration hub, a card for each console the account may open
 *   (FC 052);
 * - `{area}catalogo/` the catalog console (FC 029 F3, `catalog:write`), and one tab of it:
 *   `{area}catalogo/{productos,marcas,propiedades,publicar}/`;
 * - `{area}usuarios/` the panel of users and roles (FC 072 F2, the owner and the administrators);
 * - `{area}devoluciones/` the board of returns (FC 073, `returns:view`): the requests of the buyers and the
 *   refunds an operator prepares and another confirms;
 * - `{area}envios/` the shipping console (FC 061, `shipping:manage`): strategy, free shipping and the
 *   rate of each state. The sub-path is the same in both languages.
 *
 * @module
 */

/** Which list, and which order of it, the area shows. */
export interface AccountView {
  /**
   * The buyer's own orders, their data, their saved cards, the administration hub, the panel's orders, the catalog,
   * the shipping console or the panel of users and roles.
   */
  tab:
    | 'orders'
    | 'profile'
    | 'payment-methods'
    | 'admin'
    | 'panel'
    | 'catalog'
    | 'users'
    | 'returns'
    | 'shipping';
  /** The open order, or null for the list. */
  orderNumber: string | null;
  /** The open tab of the catalog console, or none (the first one). */
  section?: CatalogSection | null;
}

/**
 * The URL segment of each tab that has a fixed address of its own (the buyer's orders have none:
 * they are the root of the area). The one table the client and the platform guard both read
 * (FC 074 K-77): `scripts/lib/spaExportValidation.ts` checks that `public/.htaccess` admits each
 * of these and nothing else, so an address the page does not know answers a real 404.
 */
export const ACCOUNT_SEGMENTS = {
  profile: 'datos',
  'payment-methods': 'metodos-pago',
  admin: 'administracion',
  panel: 'panel',
  catalog: 'catalogo',
  users: 'usuarios',
  returns: 'devoluciones',
  shipping: 'envios',
} as const satisfies Partial<Record<AccountView['tab'], string>>;

/** The tabs of the catalog console that have an address of their own (FC 052 T1.1). */
export const CATALOG_SECTIONS = [
  'productos',
  'marcas',
  'propiedades',
  'publicar',
] as const;

/** One of {@link CATALOG_SECTIONS}. */
export type CatalogSection = (typeof CATALOG_SECTIONS)[number];

/** The tab a fixed segment opens, by its segment. */
const TAB_OF_SEGMENT = new Map<string, keyof typeof ACCOUNT_SEGMENTS>(
  (Object.keys(ACCOUNT_SEGMENTS) as (keyof typeof ACCOUNT_SEGMENTS)[]).map(
    (tab) => [ACCOUNT_SEGMENTS[tab], tab]
  )
);

/** Shape of a public order number. */
const ORDER_NUMBER = /^YEK-\d{4}-[0-9A-Z]{8}$/;

/**
 * The view a path asks for. Anything it does not recognize is the buyer's list.
 *
 * @param pathname - Current URL path.
 * @param area - The area's own path, e.g. `/cuenta/`.
 * @returns The view.
 */
export function parseAccountPath(pathname: string, area: string): AccountView {
  const rest = pathname.startsWith(area) ? pathname.slice(area.length) : '';
  const [first = '', second = ''] = rest.split('/');
  const tab = TAB_OF_SEGMENT.get(first);
  if (tab === 'catalog') {
    const section = CATALOG_SECTIONS.find((name) => name === second) ?? null;
    return { tab, orderNumber: null, section };
  }
  if (tab === 'panel') {
    return {
      tab,
      orderNumber: ORDER_NUMBER.test(second) ? second : null,
    };
  }
  if (tab !== undefined) return { tab, orderNumber: null };
  return {
    tab: 'orders',
    orderNumber: ORDER_NUMBER.test(first) ? first : null,
  };
}

/**
 * The path of a view.
 *
 * @param area - The area's own path, e.g. `/cuenta/`.
 * @param view - Which list and order.
 * @returns e.g. `/cuenta/panel/YEK-2026-AB12CD34/`.
 */
export function accountPath(area: string, view: AccountView): string {
  if (view.tab === 'orders') {
    return view.orderNumber ? `${area}${view.orderNumber}/` : area;
  }
  const segment = `${area}${ACCOUNT_SEGMENTS[view.tab]}/`;
  if (view.tab === 'catalog') {
    return view.section ? `${segment}${view.section}/` : segment;
  }
  return view.tab === 'panel' && view.orderNumber
    ? `${segment}${view.orderNumber}/`
    : segment;
}
