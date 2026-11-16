'use client';

import { usePathname } from 'next/navigation';
import { locales, type Locale, type Messages } from '@/app/i18n';
import { routeFor, translatePath } from '@/lib/routes';

/** Props of {@link LanguageSwitcher}. */
interface LanguageSwitcherProps {
  /** Language of the current page; its link is marked with `aria-current`. */
  locale: Locale;
  /** Localized navigation label, language codes and names. */
  messages: Messages['languageSwitcher'];
}

/**
 * The language switch (FC 046 T2.1, FC 052 T2.3): a small pill that shows only the two-letter codes,
 * `ES | EN`, with the active one filled. It is drawn at half its former size (24 × 46 px) and each
 * code keeps a touch area of 44 px in height, and 33 px in width, through a transparent layer that
 * reaches out of the link without ever covering its neighbour (the two codes cannot both be 44 px
 * wide in 46 px). Each code is still a real link to the same page in that language, so
 * it works without JavaScript between the two root documents. Its accessible name is the visible
 * code followed by the full name of the language («ES, Español»): the code first, so a person who
 * says what they see («click ES») is understood (WCAG 2.5.3 Label in Name, which axe checks).
 */
export function LanguageSwitcher({
  locale,
  messages,
}: Readonly<LanguageSwitcherProps>) {
  // Same page in the other language: Spanish and English slugs differ, so map through the route
  // table (a product page keeps its slug and swaps the catalog prefix).
  const pathname = usePathname() ?? routeFor('home', locale);
  return (
    <nav
      aria-label={messages.label}
      className="inline-flex h-6 items-center rounded-full border border-marfil/30 text-[10px] font-semibold"
    >
      {locales.map((target, index) => (
        <a
          key={target}
          href={translatePath(pathname, target)}
          hrefLang={target}
          lang={target}
          aria-label={`${messages.codes[target]}, ${messages.names[target]}`}
          aria-current={target === locale ? 'true' : undefined}
          className={`relative flex h-full w-[22px] items-center justify-center rounded-full after:absolute after:-inset-y-[10px] after:content-[''] ${
            index === 0
              ? 'after:-left-[11px] after:right-0'
              : 'after:-right-[11px] after:left-0'
          } ${
            target === locale
              ? 'bg-marfil text-petroleo'
              : 'text-marfil/80 hover:text-marfil'
          }`}
        >
          {messages.codes[target]}
        </a>
      ))}
    </nav>
  );
}
