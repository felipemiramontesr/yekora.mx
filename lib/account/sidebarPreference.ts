/**
 * Whether the sidebar of the account area is kept open (FC 046 T2.3): a preference of the
 * interface, not of the person: it holds no personal data. The sidebar starts folded to its icons;
 * the person who opens it finds it open on their next visit, on this device only. A browser that
 * blocks storage simply starts folded every time.
 *
 * @module
 */

/** Where the preference is kept. */
const KEY = 'yekora_account_sidebar_open_v1';

/**
 * Whether the person left the sidebar open.
 *
 * @returns True only when it was left open; folded is the default.
 */
export function readSidebarOpen(): boolean {
  try {
    return globalThis.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Remembers whether the sidebar is open. Folded is the default, so folding erases the preference.
 *
 * @param open - True when the sidebar is open.
 */
export function saveSidebarOpen(open: boolean): void {
  try {
    if (open) globalThis.localStorage.setItem(KEY, '1');
    else globalThis.localStorage.removeItem(KEY);
  } catch {
    // Storage is blocked: the sidebar starts folded next time, as it does by default.
  }
}
