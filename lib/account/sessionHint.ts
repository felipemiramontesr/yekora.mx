/**
 * The local hint of who is signed in (FC 046 T1.1, T2.2): just the first name of the person, kept
 * in the browser so the header can say «Felipe» without waiting for the API, and without asking it
 * at all while there is no hint.
 *
 * It is a hint, never proof: the API decides who is signed in (143_AN B4), and the header checks
 * the hint against `GET /v1/account/me` whenever it shows it. Nothing else is stored: not the
 * surname, the e-mail, an id, the roles or the permissions. The hint is written when the area of
 * the account confirms a session, and erased when the person signs out or the session is found
 * expired. Signing in or out in one tab reaches the others through the `storage` event, and the
 * controls of the same tab through an event of the window.
 *
 * @module
 */

/** Where the first name is kept. */
const KEY = 'yekora_session_first_name_v1';

/** What the window hears when the hint changes in this tab. */
const CHANGED = 'yekora:session-hint';

/** The longest first name kept: a hint, not a record. */
const MAX_LENGTH = 24;

/** A stored first name must look like one: no spaces and no `@`, so no e-mail is ever shown. */
const FIRST_NAME = /^[^\s@]+$/u;

/**
 * The first name of a full name: its first word, cut to {@link MAX_LENGTH}.
 *
 * @param fullName - The name as the account holds it.
 * @returns The first name, or an empty string when there is none.
 */
export function firstNameOf(fullName: string): string {
  return Array.from(fullName.trim().split(/\s+/u)[0])
    .slice(0, MAX_LENGTH)
    .join('');
}

/** Tells this tab's controls that the hint changed. */
function announce(): void {
  globalThis.dispatchEvent(new Event(CHANGED));
}

/**
 * The first name kept for this browser.
 *
 * @returns The first name, or null when there is none, it is not valid or storage is blocked.
 */
export function readSessionFirstName(): string | null {
  try {
    const value = globalThis.localStorage.getItem(KEY);
    return value !== null && FIRST_NAME.test(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Erases the hint, in this tab and in the others.
 */
export function clearSessionFirstName(): void {
  try {
    globalThis.localStorage.removeItem(KEY);
    announce();
  } catch {
    // Storage is blocked: there is nothing to erase and nobody to tell.
  }
}

/**
 * Keeps the first name of the person who is signed in. An empty name erases the hint instead.
 *
 * @param firstName - The first name, as {@link firstNameOf} cuts it.
 */
export function saveSessionFirstName(firstName: string): void {
  if (!FIRST_NAME.test(firstName)) {
    clearSessionFirstName();
    return;
  }
  try {
    globalThis.localStorage.setItem(KEY, firstName);
    announce();
  } catch {
    // Storage is blocked: the header simply keeps showing the plain account link.
  }
}

/**
 * Calls back whenever the hint changes, in this tab or in another one.
 *
 * @param listener - What to do after a change; read the hint again inside it.
 * @returns The function that stops listening.
 */
export function subscribeSessionHint(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    // A cleared storage reports no key at all.
    if (event.key === KEY || event.key === null) listener();
  };
  globalThis.addEventListener(CHANGED, listener);
  globalThis.addEventListener('storage', onStorage);
  return () => {
    globalThis.removeEventListener(CHANGED, listener);
    globalThis.removeEventListener('storage', onStorage);
  };
}
