/**
 * Who the header says is signed in (FC 047 T1.1): the account behind the local hint of the first
 * name, as `GET /v1/account/me` answers it, kept in memory only and shared by every control of the
 * header (the delivery postal code, the account menu), so the API is asked once.
 *
 * Nothing here is written to the browser: the delivery postal code is personal data and never
 * leaves the memory of the page (FC 047 T2.3); the only thing stored is the hint of the first name
 * (lib/account/sessionHint.ts). A visitor without a hint never asks the API.
 *
 * @module
 */
import { logout, me } from '@/lib/api/accountClient';
import type { MeResponse } from './authTypes';
import {
  clearSessionFirstName,
  firstNameOf,
  readSessionFirstName,
  saveSessionFirstName,
} from './sessionHint';

/** The account found for this page, or null while there is none. */
let current: MeResponse | null = null;

/** Whether the API is being asked, so two controls never ask twice. */
let asking = false;

/** The controls listening for a change. */
const listeners = new Set<() => void>();

function publish(next: MeResponse | null): void {
  current = next;
  for (const listener of listeners) listener();
}

/**
 * The account found for this page.
 *
 * @returns Who is signed in, or null while there is no one or the API has not answered.
 */
export function getHeaderUser(): MeResponse | null {
  return current;
}

/**
 * Calls back whenever the account found for this page changes.
 *
 * @param listener - What to do after a change.
 * @returns The function that stops listening.
 */
export function subscribeHeaderUser(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Asks the API who the hint belongs to, once at a time. Without a hint it asks nothing and forgets
 * the account; a session found expired erases the hint; being offline keeps what is known.
 *
 * @returns Resolves when the answer, if any, has been published.
 */
export async function syncHeaderUser(): Promise<void> {
  if (readSessionFirstName() === null) {
    if (current !== null) publish(null);
    return;
  }
  if (asking) return;
  // Held until the answer is published: saving the hint tells the controls, and they must not
  // ask again while this answer is still being handled.
  asking = true;
  try {
    const result = await me();
    if (result.ok) {
      saveSessionFirstName(firstNameOf(result.data.fullName));
      publish(result.data);
    } else if (result.reason === 'SESSION_INVALID_OR_EXPIRED') {
      clearSessionFirstName();
      publish(null);
    }
  } finally {
    asking = false;
  }
}

/**
 * Ends the session from the header: the API first, then the hint, so every control and the area of
 * the account fall back to the signed-out state at once.
 */
export async function signOutFromHeader(): Promise<void> {
  await logout();
  clearSessionFirstName();
  publish(null);
}
