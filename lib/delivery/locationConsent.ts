/**
 * Whether the visitor allowed the site to use the location of the browser to show the delivery
 * postal code (FC 055 T2.8, Enmienda 1). The choice is made in the cookie notice and kept in one
 * technical cookie of its own, declared in /cookies, that lasts a year. Without it the site never
 * asks the browser for the position, so the permission prompt only appears after a clear «yes».
 *
 * @module
 */

/** Name of the cookie that records the choice. */
const LOCATION_CONSENT_COOKIE = 'yekora_location_consent';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
/** Event the page fires when the choice changes, so the header reacts without a reload. */
const LOCATION_CONSENT_EVENT = 'yekora:location-consent';

/**
 * True when the visitor allowed the use of the location of the browser.
 *
 * @param cookies - The cookie string of the document, injectable for tests.
 */
export function hasLocationConsent(
  cookies: string = globalThis.document?.cookie ?? ''
): boolean {
  return cookies.split('; ').includes(`${LOCATION_CONSENT_COOKIE}=1`);
}

/** Records the «yes» for a year and tells the page. */
export function grantLocationConsent(): void {
  const secure = globalThis.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${LOCATION_CONSENT_COOKIE}=1; Max-Age=${ONE_YEAR_SECONDS}; Path=/; SameSite=Lax${secure}`;
  globalThis.dispatchEvent(new Event(LOCATION_CONSENT_EVENT));
}

/**
 * Calls back when the choice is made on this page.
 *
 * @param onChange - Called after the visitor allows the location.
 * @returns How to stop listening.
 */
export function subscribeLocationConsent(onChange: () => void): () => void {
  globalThis.addEventListener(LOCATION_CONSENT_EVENT, onChange);
  return () => globalThis.removeEventListener(LOCATION_CONSENT_EVENT, onChange);
}
