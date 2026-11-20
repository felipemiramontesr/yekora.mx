'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Locale, Messages } from '@/app/i18n';
import { grantLocationConsent } from '@/lib/delivery/locationConsent';
import { routeFor } from '@/lib/routes';

// Technical cookie, declared in /cookies. Only records that the notice was read.
const CONSENT_COOKIE = 'yekora_cookie_consent';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Props of {@link CookieBanner}. */
interface CookieBannerProps {
  /** Language of the page; picks the cookie policy link. */
  locale: Locale;
  /** Localized notice text, link labels and the two button labels. */
  messages: Messages['cookieBanner'];
}

// Same test as `hasConsent`, run by the browser while it parses the page, before the first paint
// and before React. No quote, `<` or `&`: React escapes those in a script's text.
const REVEAL_SCRIPT = `document.currentScript.previousElementSibling.hidden=/(^|; )${CONSENT_COOKIE}=/.test(document.cookie)`;

function hasConsent(): boolean {
  return document.cookie
    .split('; ')
    .some((entry) => entry.startsWith(`${CONSENT_COOKIE}=`));
}

/**
 * Cookie notice (LFPDPPP transparency). The site sets one technical cookie, the one that records
 * this notice was read, and, only after an explicit «Estoy de acuerdo», a second one that records
 * the permission to use the location of the browser for the delivery postal code (FC 055 T2.8).
 * «No estoy de acuerdo» only dismisses.
 *
 * FC 043 T2.1 (327_AN, option A): the notice is in the static HTML, `hidden`, followed by a
 * one-line inline script that reveals it before the first paint when the cookie is missing. So a
 * first visit sees it with the page, not after hydration (it was the LCP of /cuenta/), a returning
 * visitor never sees it flash, and without JavaScript it stays hidden, as before. Its button is
 * disabled until hydration, so a click before React is not lost (FC 043 T1.1).
 * The cookie lasts one year, SameSite=Lax, Secure on HTTPS. On a phone the notice takes at most a
 * third of the screen: its text scrolls inside it and the two buttons stay in sight.
 */
export function CookieBanner({
  locale,
  messages,
}: Readonly<CookieBannerProps>) {
  // Until mount the markup is the server's (hidden); the inline script has already set the real
  // state, so React only takes over after it, from the same cookie.
  const [mounted, setMounted] = useState(false);
  const [read, setRead] = useState(false);

  useEffect(() => {
    setRead(hasConsent());
    setMounted(true);
  }, []);

  // The notice is fixed over the bottom of the screen and, with its two choices, it is tall: while
  // it is open the page keeps its height as space at the end (`--cookie-banner-height`, used by
  // `body` in globals.css), so the links of the footer can always be scrolled out from under it.
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = section.current;
    if (!mounted || read || element === null) return;
    const root = document.documentElement;
    const reserve = () =>
      root.style.setProperty(
        '--cookie-banner-height',
        `${element.offsetHeight}px`
      );
    reserve();
    const observer = new ResizeObserver(reserve);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--cookie-banner-height');
    };
  }, [mounted, read]);

  function accept() {
    const secure = globalThis.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${CONSENT_COOKIE}=1; Max-Age=${ONE_YEAR_SECONDS}; Path=/; SameSite=Lax${secure}`;
    setRead(true);
  }

  // FC 055 T2.8: the location is used only after this explicit «I agree», which also closes the
  // notice; the browser then asks its own permission. «I do not agree» leaves it off.
  function agree() {
    grantLocationConsent();
    accept();
  }

  return (
    <>
      <section
        ref={section}
        aria-label={messages.label}
        hidden={!mounted || read}
        // The inline script below changes `hidden` before hydration, on purpose.
        suppressHydrationWarning
        className="fixed inset-x-0 bottom-0 z-50 border-t border-ocre/40 bg-petroleo text-marfil"
      >
        <div className="mx-auto flex max-h-[35vh] max-w-6xl flex-col gap-3 px-4 py-4 sm:max-h-none sm:flex-row sm:items-center sm:justify-between">
          <p className="min-h-0 overflow-y-auto text-sm sm:overflow-visible">
            {messages.text}{' '}
            <Link
              href={routeFor('privacy', locale)}
              className="tap-target underline underline-offset-4"
            >
              {messages.privacy}
            </Link>{' '}
            {messages.and}{' '}
            <Link
              href={routeFor('cookies', locale)}
              className="tap-target underline underline-offset-4"
            >
              {messages.policy}
            </Link>
            .
          </p>
          <div className="flex shrink-0 flex-wrap gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={agree}
              disabled={!mounted}
              className="min-h-11 rounded-md bg-marfil px-4 py-2 text-sm font-semibold text-petroleo"
            >
              {messages.agree}
            </button>
            <button
              type="button"
              onClick={accept}
              disabled={!mounted}
              className="min-h-11 rounded-md border border-marfil px-4 py-2 text-sm font-semibold text-marfil"
            >
              {messages.disagree}
            </button>
          </div>
        </div>
      </section>
      <script>{REVEAL_SCRIPT}</script>
    </>
  );
}
