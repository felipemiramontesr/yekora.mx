'use client';

import {
  ChevronDown,
  LogOut,
  MonitorSmartphone,
  UserRound,
} from 'lucide-react';
import { usePathname } from 'next/navigation';
import { type MouseEvent, useState } from 'react';
import type { Locale, Messages } from '@/app/i18n';
import { accountPath } from '@/lib/account/accountPaths';
import { signOutFromHeader } from '@/lib/account/headerSession';
import { isOwner, sectionsOf } from '@/lib/account/sections';
import { forgetDevice } from '@/lib/api/accountClient';
import { fill } from '@/lib/catalog/format';
import { LanguageSwitcher } from './LanguageSwitcher';
import { MenuDisclosure } from './MenuDisclosure';
import { useHeaderAccount } from './useHeaderAccount';

/** The classes of a link or button row of the menu. */
const ROW =
  'tap-target w-full justify-start gap-3 rounded-md px-3 text-left hover:bg-marfil/10';

/**
 * The account menu of the header (FC 047 T1.1, T2.4), for everybody: the one place of the account
 * and of the language. Prerendered, it is the signed-out state for all, and it opens without
 * JavaScript, since it is a native `<details>`. A person without a session finds «Entrar»,
 * «Crear cuenta» and the language; once the browser's hint of a first name is confirmed by the API
 * it holds the greeting, every section of «Mi cuenta» the account may open (the same rule as the
 * area itself, lib/account/sections), the language, «Olvidar este dispositivo» and «Salir».
 * From `xl` up the trigger shows the greeting and «Mi cuenta», like the big stores do; below, only
 * the icon, with the same words read by assistive technology.
 *
 * @param locale - Language of the page.
 * @param area - Path of the account area in that language.
 * @param messages - `header` texts.
 * @param dashboard - `account.dashboard` texts: the names of the sections and of the device actions.
 * @param languageMessages - `languageSwitcher` texts.
 */
export function AccountMenu({
  locale,
  area,
  messages,
  dashboard,
  languageMessages,
}: Readonly<{
  locale: Locale;
  area: string;
  messages: Messages['header'];
  dashboard: Messages['account']['dashboard'];
  languageMessages: Messages['languageSwitcher'];
}>) {
  const { firstName, user } = useHeaderAccount();
  const pathname = usePathname();
  const [busy, setBusy] = useState<'leaving' | 'forgetting' | null>(null);
  const [note, setNote] = useState('');
  const menu = messages.accountMenu;
  const signedIn = firstName !== null;
  const sections = user ? sectionsOf(user) : (['orders'] as const);

  // The sections of the area are paths the area routes by itself (Apache serves it for each of
  // them; the static export has no page per path), so they are plain anchors. Inside the area a
  // click changes the view without reloading it: the address is pushed and the area, which reads
  // the address, is told. Anywhere else, or with a modifier key, it is an ordinary navigation.
  const inArea = pathname !== null && pathname.startsWith(area);
  function follow(event: MouseEvent<HTMLAnchorElement>, href: string) {
    const modified =
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey;
    if (!inArea || modified) return;
    event.preventDefault();
    globalThis.history.pushState(null, '', href);
    globalThis.dispatchEvent(new PopStateEvent('popstate'));
  }

  async function leave() {
    setBusy('leaving');
    await signOutFromHeader();
    setBusy(null);
  }

  async function forget() {
    setBusy('forgetting');
    const result = await forgetDevice();
    setBusy(null);
    setNote(result.ok ? dashboard.deviceForgotten : menu.deviceFailed);
  }

  return (
    <MenuDisclosure className="relative shrink-0">
      <summary className="tap-target cursor-pointer list-none justify-center gap-2">
        <UserRound aria-hidden="true" size={24} />
        {/* The name of the control is this text itself, so what is seen and what is announced are
            always the same words (WCAG 2.5.3, which axe checks). Below xl it is visually hidden
            but still read, so only the icon shows on a phone. */}
        <span className="flex flex-col text-left leading-tight max-xl:sr-only">
          <span className="max-w-[9rem] truncate text-xs text-marfil/80">
            {signedIn ? fill(menu.greeting, { name: firstName }) : menu.enter}
          </span>
          <span className="flex items-center gap-1 text-sm font-semibold">
            {messages.account}
            <ChevronDown aria-hidden="true" size={14} />
          </span>
        </span>
      </summary>
      <div className="absolute right-0 z-50 mt-3 flex w-64 flex-col gap-1 rounded-lg border border-marfil/10 bg-petroleo p-2 text-sm shadow-lg">
        {signedIn ? (
          <>
            <p className="flex items-center gap-2 px-3 py-2 font-semibold">
              <span className="truncate">{user?.fullName ?? firstName}</span>
              {user && isOwner(user) && (
                <span className="rounded-full border border-ocre px-2 text-xs font-normal">
                  {dashboard.ownerBadge}
                </span>
              )}
            </p>
            <nav aria-label={messages.account}>
              <ul className="flex flex-col">
                {sections.map((section) => {
                  const href = accountPath(area, {
                    tab: section,
                    orderNumber: null,
                  });
                  return (
                    <li key={section}>
                      <a
                        href={href}
                        aria-current={pathname === href ? 'page' : undefined}
                        onClick={(event) => follow(event, href)}
                        className={`${ROW} aria-[current=page]:border-l-[3px] aria-[current=page]:border-ocre aria-[current=page]:bg-ocre/15`}
                      >
                        {dashboard[section]}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </>
        ) : (
          <div className="flex flex-col gap-1">
            <a
              href={area}
              onClick={(event) => follow(event, area)}
              className="tap-target justify-center rounded-md bg-marfil px-3 font-semibold text-petroleo"
            >
              {menu.enter}
            </a>
            <a
              href={`${area}?action=register`}
              onClick={(event) => follow(event, `${area}?action=register`)}
              className={`${ROW} justify-center`}
            >
              {menu.createAccount}
            </a>
          </div>
        )}
        <div className="mt-1 flex items-center justify-between gap-3 border-t border-marfil/15 px-3 pt-3">
          <span>{menu.language}</span>
          <LanguageSwitcher locale={locale} messages={languageMessages} />
        </div>
        {signedIn && (
          <div className="mt-1 flex flex-col gap-1 border-t border-marfil/15 pt-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void forget()}
              className={`${ROW} disabled:opacity-60`}
            >
              <MonitorSmartphone aria-hidden="true" size={18} />
              {busy === 'forgetting'
                ? dashboard.forgettingDevice
                : dashboard.forgetDevice}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void leave()}
              className={`${ROW} border-2 border-ocre font-semibold hover:bg-ocre/15 disabled:opacity-60`}
            >
              <LogOut aria-hidden="true" size={18} />
              {busy === 'leaving' ? dashboard.signingOut : messages.signOut}
            </button>
            <p role="status" className="px-3 text-xs text-marfil/90">
              {note}
            </p>
          </div>
        )}
      </div>
    </MenuDisclosure>
  );
}
