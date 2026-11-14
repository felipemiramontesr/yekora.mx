'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { MeResponse } from '@/lib/account/authTypes';
import {
  getHeaderUser,
  subscribeHeaderUser,
  syncHeaderUser,
} from '@/lib/account/headerSession';
import {
  readSessionFirstName,
  subscribeSessionHint,
} from '@/lib/account/sessionHint';

/** What the header knows about who is signed in. */
interface HeaderAccount {
  /** The first name kept as a local hint, or null (also while the page has not mounted yet). */
  firstName: string | null;
  /** The account the API confirmed, or null until it answers or when there is none. */
  user: MeResponse | null;
}

/**
 * The account of the header (FC 047 T1.1). Prerendered, and until the page mounts, there is no
 * one: the static HTML is the signed-out state for everybody, so it never mismatches. Once
 * mounted, a browser that keeps the hint of a first name has it at once, and the API confirms the
 * account behind it (lib/account/headerSession): the same answer for every control of the header.
 * A visitor without a hint never asks the API.
 *
 * @returns The hint and the confirmed account.
 */
export function useHeaderAccount(): HeaderAccount {
  const user = useSyncExternalStore(
    subscribeHeaderUser,
    getHeaderUser,
    () => null
  );
  const [firstName, setFirstName] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      setFirstName(readSessionFirstName());
      void syncHeaderUser();
    };
    sync();
    return subscribeSessionHint(sync);
  }, []);

  return { firstName, user };
}
