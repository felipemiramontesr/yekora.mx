/**
 * What the browser keeps, for the length of one tab, of who is signed in (FC 053 F2): enough to
 * paint the greeting of the account area at once while the API confirms the session. It lives in
 * `sessionStorage`, so it dies with the tab, and it is never proof: the area asks the API
 * (`GET /v1/account/me`) every time it paints from here and replaces or erases what it shows.
 *
 * Only the id, the first name and the roles and permissions of the account are kept (the set the
 * FC 053 names: `userId`, `firstName`, `roles`, `permissions`). The e-mail, the
 * phone, the postal code, the state and the addresses never reach the browser's storage
 * (FC 053 T2.2, FC 047 T2.3, FC 051 T2.6): {@link saveSessionCache} copies four fields by name, so
 * a new field of the API can never end up here by accident.
 *
 * @module
 */
import type { MeResponse } from './authTypes';

/** Where the cache is kept. */
const KEY = 'yekora_session_cache_v1';

/** What is kept of the account: no contact data and no address. */
export interface SessionCache {
  /** Id of the account. */
  userId: string;
  /** First name, as the header greets. */
  firstName: string;
  /** Roles of the account. */
  roles: string[];
  /** Permissions of the account. */
  permissions: string[];
}

/**
 * Whether `value` is a list of strings.
 *
 * @param value - Anything read from storage.
 * @returns True for an array made only of strings.
 */
function isTextList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

/**
 * Keeps the account in this tab, only the fields that carry no contact data.
 *
 * @param account - The account `GET /v1/account/me` confirmed.
 * @param firstName - Its first name, as `firstNameOf` (lib/account/sessionHint.ts) cuts it.
 */
export function saveSessionCache(account: MeResponse, firstName: string): void {
  const kept: SessionCache = {
    userId: account.id,
    firstName,
    roles: account.roles,
    permissions: account.permissions,
  };
  try {
    globalThis.sessionStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Storage is blocked or full: the area simply waits for the API.
  }
}

/**
 * Reads the account kept in this tab.
 *
 * @returns What was kept, or null when there is nothing, it is not what this module writes, or
 * storage is blocked.
 */
export function readSessionCache(): SessionCache | null {
  try {
    const raw = globalThis.sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { userId, firstName, roles, permissions } = value as Record<
      string,
      unknown
    >;
    if (typeof userId !== 'string' || typeof firstName !== 'string') {
      return null;
    }
    if (!isTextList(roles) || !isTextList(permissions)) return null;
    return { userId, firstName, roles, permissions };
  } catch {
    return null;
  }
}

/** Erases what this tab kept: the session ended, or the API said it is not valid. */
export function clearSessionCache(): void {
  try {
    globalThis.sessionStorage.removeItem(KEY);
  } catch {
    // Storage is blocked: there is nothing to erase.
  }
}
