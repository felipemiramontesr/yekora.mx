'use client';

import { usePathname } from 'next/navigation';
import { locales, type Locale, type Messages } from '@/app/i18n';

interface LanguageSwitcherProps {
  locale: Locale;
  messages: Messages['languageSwitcher'];
}

// Same page in the other language: swap only the first path segment.
function localizedPath(pathname: string, target: Locale): string {
  const [, , ...rest] = pathname.split('/');
  return ['', target, ...rest].join('/');
}

export function LanguageSwitcher({
  locale,
  messages,
}: Readonly<LanguageSwitcherProps>) {
  const pathname = usePathname() ?? `/${locale}`;
  return (
    <nav
      aria-label={messages.label}
      className="flex items-center gap-2 text-sm"
    >
      {locales.map((target) => (
        <a
          key={target}
          href={localizedPath(pathname, target)}
          hrefLang={target}
          lang={target}
          aria-current={target === locale ? 'true' : undefined}
          className={
            target === locale
              ? 'font-semibold underline underline-offset-4'
              : 'opacity-80 hover:opacity-100'
          }
        >
          {messages.names[target]}
        </a>
      ))}
    </nav>
  );
}
