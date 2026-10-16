'use client';

import { useEffect, useState } from 'react';
import type { Locale, Messages } from '@/app/i18n';

// Technical cookie, declared in /cookies. Only records that the notice was read.
const CONSENT_COOKIE = 'yekora_cookie_consent';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

interface CookieBannerProps {
  locale: Locale;
  messages: Messages['cookieBanner'];
}

function hasConsent(): boolean {
  return document.cookie
    .split('; ')
    .some((entry) => entry.startsWith(`${CONSENT_COOKIE}=`));
}

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
            href={`/${locale}/cookies`}
            className="underline underline-offset-4"
          >
            {messages.policy}
          </a>
        </p>
        <button
          type="button"
          onClick={accept}
          className="self-start rounded-md bg-marfil px-4 py-2 text-sm font-semibold text-petroleo sm:self-auto"
        >
          {messages.accept}
        </button>
      </div>
    </section>
  );
}
