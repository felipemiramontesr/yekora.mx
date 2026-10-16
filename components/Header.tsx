import { Menu } from 'lucide-react';
import { disciplines, type Locale, type Messages } from '@/app/i18n';
import { routeFor } from '@/lib/routes';
import { LanguageSwitcher } from './LanguageSwitcher';

interface HeaderProps {
  locale: Locale;
  messages: Messages;
}

// Disciplines, About and the catalog placeholder, shared by the desktop bar and the mobile menu.
function NavItems({ locale, messages }: Readonly<HeaderProps>) {
  return (
    <>
      {disciplines.map((discipline) => (
        <li key={discipline}>
          <a
            href={`${routeFor('home', locale)}#${discipline}`}
            className="tap-target underline-offset-4 hover:underline"
          >
            {messages.disciplines[discipline]}
          </a>
        </li>
      ))}
      <li>
        <a
          href={routeFor('about', locale)}
          className="tap-target underline-offset-4 hover:underline"
        >
          {messages.header.about}
        </a>
      </li>
      <li>
        {/* No catalog route exists yet: a label, never a link that 404s. */}
        <span aria-disabled="true" className="opacity-70">
          {messages.header.catalog}{' '}
          <span className="rounded-full border border-ocre px-2 py-0.5 text-xs">
            {messages.header.comingSoon}
          </span>
        </span>
      </li>
    </>
  );
}

export function Header({ locale, messages }: Readonly<HeaderProps>) {
  return (
    <header className="sticky top-0 z-40 bg-petroleo text-marfil">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-3">
        <a
          href={routeFor('home', locale)}
          aria-label={messages.brand.homeLink}
          className="tap-target shrink-0 gap-3"
        >
          {/* Horizontal lockup from the client's individual elements; the name is never retyped.
              The link's aria-label names it, so the images are decorative. */}
          <img
            src="/brand/elements/YEKORA_01_ISOTIPO_MARFIL.svg"
            alt=""
            width={28}
            height={32}
          />
          <img
            src="/brand/elements/YEKORA_02_NOMBRE_MARFIL.svg"
            alt=""
            width={101}
            height={18}
          />
        </a>
        <nav
          aria-label={messages.header.navLabel}
          className="hidden flex-1 xl:block"
        >
          <ul className="flex flex-wrap items-center gap-5 text-sm">
            <NavItems locale={locale} messages={messages} />
          </ul>
        </nav>
        <div className="hidden xl:block">
          <LanguageSwitcher
            locale={locale}
            messages={messages.languageSwitcher}
          />
        </div>
        {/* Phones and tablets: menu without client JavaScript (native <details>/<summary>).
            The full bar needs xl: below 1280 px it wraps onto two lines. */}
        <details className="relative xl:hidden">
          <summary className="tap-target cursor-pointer list-none gap-2 px-1 text-sm">
            <Menu aria-hidden="true" size={22} />
            {messages.header.menu}
          </summary>
          <nav
            aria-label={messages.header.navLabel}
            className="absolute right-0 mt-3 w-64 rounded-lg bg-petroleo p-4 shadow-lg"
          >
            <ul className="flex flex-col text-sm">
              <NavItems locale={locale} messages={messages} />
            </ul>
            <div className="mt-4 border-t border-marfil/20 pt-4">
              <LanguageSwitcher
                locale={locale}
                messages={messages.languageSwitcher}
              />
            </div>
          </nav>
        </details>
      </div>
    </header>
  );
}
