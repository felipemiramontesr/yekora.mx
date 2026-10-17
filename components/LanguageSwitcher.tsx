'use client';

import { Globe } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { locales, type Locale, type Messages } from '@/app/i18n';
import { pageFromPath, routeFor } from '@/lib/routes';

/** Props of {@link LanguageSwitcher}. */
interface LanguageSwitcherProps {
  /** Language of the current page; its link is marked with `aria-current`. */
  locale: Locale;
  /** Localized navigation label and language names. */
  messages: Messages['languageSwitcher'];
}

/**
 * Links to the current page in every language. The globe icon is decorative: each link is
 * named by its language written in that language ("Español", "English").
 */
export function LanguageSwitcher({
  locale,
  messages,
}: Readonly<LanguageSwitcherProps>) {
  // Same page in the other language: Spanish and English slugs differ, so map through the route table.
  const page = pageFromPath(usePathname() ?? routeFor('home', locale));
  return (
    <nav
      aria-label={messages.label}
      className="flex items-center gap-2 text-sm"
    >
      <Globe aria-hidden="true" size={18} className="shrink-0 opacity-80" />
      {locales.map((target) => (
        <a
          key={target}
          href={routeFor(page, target)}
          hrefLang={target}
          lang={target}
          aria-current={target === locale ? 'true' : undefined}
          className={`tap-target justify-center ${
            target === locale
              ? 'font-semibold underline underline-offset-4'
              : 'opacity-80 hover:opacity-100'
          }`}
        >
          {messages.names[target]}
        </a>
      ))}
    </nav>
  );
}
