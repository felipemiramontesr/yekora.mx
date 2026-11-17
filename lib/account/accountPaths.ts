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
 * - `{area}administradores/` the administrators console (FC 044 F2, the owner only).
 *
 * @module
 */

/** Which list, and which order of it, the area shows. */
export interface AccountView {
  /**
   * The buyer's own orders, their data, their saved cards, the administration hub, the panel's orders, the catalog or
   * the administrators console.
   */
  tab:
    | 'orders'
    | 'profile'
    | 'payment-methods'
    | 'admin'
    | 'panel'
    | 'catalog'
    | 'admins';
  /** The open order, or null for the list. */
  orderNumber: string | null;
  /** The open tab of the catalog console, or none (the first one). */
  section?: CatalogSection | null;
}

/** The tabs of the catalog console that have an address of their own (FC 052 T1.1). */
const CATALOG_SECTIONS = [
  'productos',
  'marcas',
  'propiedades',
  'publicar',
] as const;

/** One of {@link CATALOG_SECTIONS}. */
export type CatalogSection = (typeof CATALOG_SECTIONS)[number];

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
  if (first === 'datos') return { tab: 'profile', orderNumber: null };
  if (first === 'metodos-pago') {
    return { tab: 'payment-methods', orderNumber: null };
  }
  if (first === 'administracion') return { tab: 'admin', orderNumber: null };
  if (first === 'catalogo') {
    const section = CATALOG_SECTIONS.find((name) => name === second) ?? null;
    return { tab: 'catalog', orderNumber: null, section };
  }
  if (first === 'administradores') return { tab: 'admins', orderNumber: null };
  if (first === 'panel') {
    return {
      tab: 'panel',
      orderNumber: ORDER_NUMBER.test(second) ? second : null,
    };
  }
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
  if (view.tab === 'profile') return `${area}datos/`;
  if (view.tab === 'payment-methods') return `${area}metodos-pago/`;
  if (view.tab === 'admin') return `${area}administracion/`;
  if (view.tab === 'catalog') {
    const section = view.section ? `${view.section}/` : '';
    return `${area}catalogo/${section}`;
  }
  if (view.tab === 'admins') return `${area}administradores/`;
  const tab = view.tab === 'panel' ? 'panel/' : '';
  const order = view.orderNumber ? `${view.orderNumber}/` : '';
  return `${area}${tab}${order}`;
}
