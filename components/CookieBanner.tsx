'use client';

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

function hasConsent(): boolean {
  return document.cookie
    .split('; ')
    .some((entry) => entry.startsWith(`${CONSENT_COOKIE}=`));
}

/**
 * Cookie notice (LFPDPPP transparency). The site sets a single technical cookie, the one that
 * records this notice was read, so there is nothing to opt into: the button only dismisses.
 *
 * Hidden in the static HTML and shown after hydration only when the cookie is missing, so a
 * returning visitor never sees it flash. The cookie lasts one year, SameSite=Lax, Secure on HTTPS.
 */
export function CookieBanner({
  locale,
  messages,
}: Readonly<CookieBannerProps>) {
  // Hidden on the server render; shown after mount only when the notice was not read yet.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(!hasConsent());
  }, []);

  if (!visible) return null;

  function accept() {
    const secure = globalThis.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${CONSENT_COOKIE}=1; Max-Age=${ONE_YEAR_SECONDS}; Path=/; SameSite=Lax${secure}`;
    setVisible(false);
  }

  return (
    <section
      aria-label={messages.label}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-ocre/40 bg-petroleo text-marfil"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          {messages.text}{' '}
          <a
            href={routeFor('cookies', locale)}
            className="tap-target underline underline-offset-4"
          >
            {messages.policy}
          </a>
        </p>
        <button
          type="button"
          onClick={accept}
          className="min-h-11 self-start rounded-md bg-marfil px-4 py-2 text-sm font-semibold text-petroleo sm:self-auto"
        >
          {messages.accept}
        </button>
      </div>
    </section>
  );
}
