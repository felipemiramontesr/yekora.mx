/**
 * Paths inside the account area (FC 028 F2, T2.6c). The area is one static page per language
 * (`/cuenta/`, `/en/account/`); Apache answers every sub-path with that page
 * (public/.htaccess), and the page reads the path to open the right view. The sub-paths are
 * the same in both languages, so the language switcher keeps the open order:
 *
 * - `{area}` my orders · `{area}{order}/` one of them;
 * - `{area}panel/` every order (staff) · `{area}panel/{order}/` one of them;
 * - `{area}catalogo/` the catalog console (FC 029 F3, `catalog:write`).
 *
 * @module
 */

/** Which list, and which order of it, the area shows. */
export interface AccountView {
  /** The buyer's own orders, the panel's, or the catalog console. */
  tab: 'orders' | 'panel' | 'catalog';
  /** The open order, or null for the list. */
  orderNumber: string | null;
}

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
  if (first === 'catalogo') return { tab: 'catalog', orderNumber: null };
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
  if (view.tab === 'catalog') return `${area}catalogo/`;
  const tab = view.tab === 'panel' ? 'panel/' : '';
  const order = view.orderNumber ? `${view.orderNumber}/` : '';
  return `${area}${tab}${order}`;
}
