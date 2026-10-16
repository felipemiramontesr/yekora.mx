'use client';

import { usePathname } from 'next/navigation';
import { locales, type Locale, type Messages } from '@/app/i18n';
import { pageFromPath, routeFor } from '@/lib/routes';

interface LanguageSwitcherProps {
  locale: Locale;
  messages: Messages['languageSwitcher'];
}

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
