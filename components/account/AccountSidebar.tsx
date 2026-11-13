'use client';

import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  LogOut,
  type LucideIcon,
  MonitorSmartphone,
  Package,
  ShieldCheck,
  Store,
  X,
} from 'lucide-react';
import { type MouseEvent, useEffect, useRef } from 'react';
import type { Messages } from '@/app/i18n';
import type { AccountView } from '@/lib/account/accountPaths';
import type { MeResponse } from '@/lib/account/authTypes';

/** One section the sidebar offers: already filtered by what the account may open. */
interface SidebarSection {
  /** Which view it opens. */
  tab: AccountView['tab'];
  /** Its name. */
  label: string;
  /** Where it leads, for a click with the modifier keys or without JavaScript. */
  href: string;
}

/** The icon of each section. */
const ICONS: Record<AccountView['tab'], LucideIcon> = {
  orders: Package,
  panel: ClipboardList,
  catalog: Store,
  admins: ShieldCheck,
};

/**
 * The initials of a name: the first letter of its first two words, in capitals.
 *
 * @param fullName - The name as the account holds it.
 * @returns One or two letters.
 */
function initialsOf(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join('')
    .toUpperCase();
}

/** Classes of one section link: the active one has an ocre border on its left (T2.3). */
const linkClass = (active: boolean, expanded: boolean) =>
  `tap-target w-full gap-3 border-l-[3px] px-3 py-2 ${
    active
      ? 'border-ocre bg-ocre/15 text-marfil'
      : 'border-transparent text-marfil/70 hover:bg-marfil/10 hover:text-marfil'
  } ${expanded ? '' : 'md:justify-center md:px-0'}`;

/** Classes of a label: on a wide screen a folded sidebar keeps only the icon on view. */
const labelClass = (expanded: boolean) => (expanded ? '' : 'md:sr-only');

/** Props of {@link AccountSidebar}. */
interface AccountSidebarProps {
  /** Who is signed in; only the name and the Owner role are shown, never the e-mail. */
  user: MeResponse;
  /** `account.dashboard` texts. */
  texts: Messages['account']['dashboard'];
  /** The sections this account may open, in order. */
  sections: readonly SidebarSection[];
  /** The open section. */
  active: AccountView['tab'];
  /** On a wide screen: open (220 px, icons and names) or folded (80 px, icons). */
  expanded: boolean;
  /** Folds or opens it on a wide screen. */
  onToggleExpanded: () => void;
  /** On a phone: whether the drawer is open. */
  drawerOpen: boolean;
  /** Closes the drawer. */
  onCloseDrawer: () => void;
  /** A section was chosen. */
  onSelect: (tab: AccountView['tab']) => void;
  /** «Olvidar este dispositivo». */
  onForgetDevice: () => void;
  forgetting: boolean;
  /** «Salir». */
  onSignOut: () => void;
  leaving: boolean;
}

/**
 * The sidebar of the account area, on the left (FC 046 T1.2, T2.3). On a wide screen it is fixed
 * beside the work area, folded to its icons by default (80 px, each with its name as `title` and
 * accessible name) or open (220 px), switched by a tab with an arrow on its right edge. On a phone
 * it is a drawer of 250 px over a dimmed and blurred page: it takes the focus when it opens, and
 * closes with Escape, its close button, the dimmed background or choosing a section.
 *
 * From top to bottom: the avatar and name of the person, never the e-mail, with the Owner badge
 * when it applies; the sections the account may open, the active one marked with a 3 px ocre
 * border; and, at the foot, «Olvidar este dispositivo» and «Salir». The identity colors are the
 * client's: petróleo, marfil and ocre.
 *
 * @param user - Who is signed in.
 * @param texts - `account.dashboard` texts.
 * @param sections - The sections this account may open.
 * @param active - The open section.
 * @param expanded - Open or folded on a wide screen.
 * @param onToggleExpanded - Folds or opens it.
 * @param drawerOpen - Whether the phone drawer is open.
 * @param onCloseDrawer - Closes the drawer.
 * @param onSelect - A section was chosen.
 * @param onForgetDevice - Forget this device.
 * @param forgetting - Forgetting is under way.
 * @param onSignOut - Sign out.
 * @param leaving - Signing out is under way.
 */
export function AccountSidebar({
  user,
  texts,
  sections,
  active,
  expanded,
  onToggleExpanded,
  drawerOpen,
  onCloseDrawer,
  onSelect,
  onForgetDevice,
  forgetting,
  onSignOut,
  leaving,
}: Readonly<AccountSidebarProps>) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const isOwner = user.roles.includes('owner');

  useEffect(() => {
    if (!drawerOpen) return undefined;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseDrawer();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen, onCloseDrawer]);

  return (
    <>
      {drawerOpen && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={texts.closeMenu}
          onClick={onCloseDrawer}
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm md:hidden"
        />
      )}
      <aside
        id="account-sidebar"
        aria-label={texts.sidebar}
        className={`${
          drawerOpen
            ? 'fixed inset-y-0 left-0 z-[70] flex w-[250px] overflow-y-auto md:inset-auto md:z-auto md:w-full md:overflow-visible'
            : 'hidden'
        } flex-col gap-4 bg-petroleo p-3 text-marfil shadow-lg md:sticky md:top-20 md:flex md:h-fit md:min-h-[20rem] md:w-full md:rounded-lg`}
      >
        <button
          ref={closeButton}
          type="button"
          onClick={onCloseDrawer}
          aria-label={texts.closeMenu}
          className="tap-target self-end justify-center md:hidden"
        >
          <X aria-hidden="true" size={22} />
        </button>
        <div
          className={`flex items-center gap-3 border-b border-marfil/15 pb-3 ${
            expanded ? '' : 'md:justify-center'
          }`}
        >
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-md bg-marfil/10 text-sm font-semibold text-ocre"
          >
            {initialsOf(user.fullName)}
          </span>
          <span className={`flex min-w-0 flex-col ${labelClass(expanded)}`}>
            <span className="truncate font-semibold">{user.fullName}</span>
            {isOwner && (
              <span className="self-start rounded-full border border-ocre px-2 text-xs">
                {texts.ownerBadge}
              </span>
            )}
          </span>
        </div>
        <nav aria-label={texts.tabsLabel} className="flex-1">
          <ul className="flex flex-col gap-1">
            {sections.map((section) => {
              const Icon = ICONS[section.tab];
              const current = section.tab === active;
              return (
                <li key={section.tab}>
                  <a
                    href={section.href}
                    aria-current={current ? 'page' : undefined}
                    title={expanded ? undefined : section.label}
                    onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                      event.preventDefault();
                      onSelect(section.tab);
                    }}
                    className={linkClass(current, expanded)}
                  >
                    <Icon
                      aria-hidden="true"
                      size={20}
                      className={current ? 'text-ocre' : ''}
                    />
                    <span className={labelClass(expanded)}>
                      {section.label}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex flex-col gap-2 border-t border-marfil/15 pt-3">
          <button
            type="button"
            disabled={forgetting}
            title={expanded ? undefined : texts.forgetDevice}
            onClick={onForgetDevice}
            className={`tap-target w-full gap-3 px-3 text-sm text-marfil/80 hover:text-marfil disabled:opacity-60 ${
              expanded ? '' : 'md:justify-center md:px-0'
            }`}
          >
            <MonitorSmartphone aria-hidden="true" size={20} />
            <span className={labelClass(expanded)}>
              {forgetting ? texts.forgettingDevice : texts.forgetDevice}
            </span>
          </button>
          <button
            type="button"
            disabled={leaving}
            title={expanded ? undefined : texts.signOut}
            onClick={onSignOut}
            className={`tap-target w-full gap-3 rounded-md border-2 border-ocre px-3 font-semibold text-marfil hover:bg-ocre/15 disabled:opacity-60 ${
              expanded ? '' : 'md:justify-center md:px-0'
            }`}
          >
            <LogOut aria-hidden="true" size={20} />
            <span className={labelClass(expanded)}>
              {leaving ? texts.signingOut : texts.signOut}
            </span>
          </button>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="account-sidebar"
          aria-label={expanded ? texts.collapse : texts.expand}
          onClick={onToggleExpanded}
          className="absolute -right-5 top-1/2 hidden h-12 w-11 -translate-y-1/2 items-center justify-center rounded-md bg-ocre text-petroleo shadow-lg hover:brightness-110 md:flex"
        >
          {expanded ? (
            <ChevronLeft aria-hidden="true" size={18} />
          ) : (
            <ChevronRight aria-hidden="true" size={18} />
          )}
        </button>
      </aside>
    </>
  );
}
