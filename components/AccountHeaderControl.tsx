'use client';

import { UserRound } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Messages } from '@/app/i18n';
import {
  clearSessionFirstName,
  firstNameOf,
  readSessionFirstName,
  saveSessionFirstName,
  subscribeSessionHint,
} from '@/lib/account/sessionHint';
import { logout, me } from '@/lib/api/accountClient';
import { MenuDisclosure } from './MenuDisclosure';

/**
 * The account control of the header (FC 046 T1.1, T2.2). Prerendered, and for anyone without a
 * local hint, it is the plain link to the account area with its icon, so the static page never
 * mismatches and it works without JavaScript. Once mounted, a person whose browser keeps the hint
 * of their first name sees it next to the icon, from `xl` up (below, only the icon, named by its
 * `aria-label`), with a menu: «Mi cuenta» and «Salir». The hint is checked against
 * `GET /v1/account/me` when it is shown, and only then: a visitor without a hint never asks the
 * API. A session found expired erases the hint; so does «Salir», and the area of the account
 * reacts to the same change.
 *
 * @param href - Path of the account area in the page's language.
 * @param messages - `header` texts.
 */
export function AccountHeaderControl({
  href,
  messages,
}: Readonly<{ href: string; messages: Messages['header'] }>) {
  const [firstName, setFirstName] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const sync = () => setFirstName(readSessionFirstName());
    sync();
    if (readSessionFirstName() !== null) {
      void me().then((result) => {
        if (result.ok) saveSessionFirstName(firstNameOf(result.data.fullName));
        else if (result.reason === 'SESSION_INVALID_OR_EXPIRED') {
          clearSessionFirstName();
        }
      });
    }
    return subscribeSessionHint(sync);
  }, []);

  async function signOut() {
    setLeaving(true);
    await logout();
    clearSessionFirstName();
    setLeaving(false);
  }

  if (firstName === null) {
    return (
      <Link
        href={href}
        aria-label={messages.account}
        className="tap-target shrink-0 justify-center"
      >
        <UserRound aria-hidden="true" size={24} />
      </Link>
    );
  }
  return (
    <MenuDisclosure className="relative shrink-0">
      <summary
        aria-label={`${messages.account}: ${firstName}`}
        className="tap-target cursor-pointer list-none justify-center gap-2"
      >
        <UserRound aria-hidden="true" size={24} />
        <span
          aria-hidden="true"
          className="hidden max-w-[10rem] truncate text-sm xl:inline"
        >
          {firstName}
        </span>
      </summary>
      <ul className="absolute right-0 mt-3 w-56 rounded-lg bg-petroleo p-2 text-sm shadow-lg">
        <li>
          <Link href={href} className="tap-target w-full px-2 hover:underline">
            {messages.account}
          </Link>
        </li>
        <li>
          <button
            type="button"
            disabled={leaving}
            onClick={() => void signOut()}
            className="tap-target w-full px-2 text-left hover:underline disabled:opacity-60"
          >
            {messages.signOut}
          </button>
        </li>
      </ul>
    </MenuDisclosure>
  );
}
