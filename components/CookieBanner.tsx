'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Locale, Messages } from '@/app/i18n';
import { routeFor } from '@/lib/routes';

// Technical cookie, declared in /cookies. Only records that the notice was read.
const CONSENT_COOKIE = 'yekora_cookie_consent';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Props of {@link CookieBanner}. */
interface CookieBannerProps {
  /** Language of the page; picks the cookie policy link. */
  locale: Locale;
  /** Localized notice text, link label and button label. */
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
 * Cookie notice (LFPDPPP transparency). The site sets a single technical cookie, the one that
 * records this notice was read, so there is nothing to opt into: the button only dismisses.
 *
 * FC 043 T2.1 (327_AN, option A): the notice is in the static HTML, `hidden`, followed by a
 * one-line inline script that reveals it before the first paint when the cookie is missing. So a
 * first visit sees it with the page, not after hydration (it was the LCP of /cuenta/), a returning
 * visitor never sees it flash, and without JavaScript it stays hidden, as before. Its button is
 * disabled until hydration, so a click before React is not lost (FC 043 T1.1).
 * The cookie lasts one year, SameSite=Lax, Secure on HTTPS.
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

  function accept() {
    const secure = globalThis.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${CONSENT_COOKIE}=1; Max-Age=${ONE_YEAR_SECONDS}; Path=/; SameSite=Lax${secure}`;
    setRead(true);
  }

  return (
    <>
      <section
        aria-label={messages.label}
        hidden={!mounted || read}
        // The inline script below changes `hidden` before hydration, on purpose.
        suppressHydrationWarning
        className="fixed inset-x-0 bottom-0 z-50 border-t border-ocre/40 bg-petroleo text-marfil"
      >
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            {messages.text}{' '}
            <Link
              href={routeFor('cookies', locale)}
              className="tap-target underline underline-offset-4"
            >
              {messages.policy}
            </Link>
          </p>
          <button
            type="button"
            onClick={accept}
            disabled={!mounted}
            className="min-h-11 self-start rounded-md bg-marfil px-4 py-2 text-sm font-semibold text-petroleo sm:self-auto"
          >
            {messages.accept}
          </button>
        </div>
      </section>
      <script>{REVEAL_SCRIPT}</script>
    </>
  );
}
