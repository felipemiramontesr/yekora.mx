import Link from 'next/link';
import { disciplines, type Locale, type Messages } from '@/app/i18n';
import { routeFor, searchIndexPath } from '@/lib/routes';
import { AccountMenu } from './AccountMenu';
import { CartButton } from './cart/CartButton';
import { DeliveryIndicator } from './DeliveryIndicator';
import { SearchCombobox } from './SearchCombobox';

/** Props of {@link Header}. */
interface HeaderProps {
  /** Language of the page; picks the localized links. */
  locale: Locale;
  /** Full dictionary of that language. */
  messages: Messages;
}

/**
 * The strip of disciplines under the bar (FC 047 T2.1): each one leads to its products in the
 * catalog (`?disciplina=`). On a phone it scrolls sideways and fades at its edge, so nothing is
 * hidden and nothing wraps onto a second line.
 */
function DisciplineBar({ locale, messages }: Readonly<HeaderProps>) {
  return (
    <nav
      aria-label={messages.header.disciplinesLabel}
      className="bg-petroleo text-marfil"
    >
      <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 text-sm [mask-image:linear-gradient(to_right,black_90%,transparent)] [scrollbar-width:none] md:[mask-image:none]">
        {disciplines.map((discipline) => (
          <li key={discipline} className="shrink-0">
            <Link
              href={`${routeFor('catalog', locale)}?disciplina=${discipline}`}
              className="tap-target px-3 underline-offset-4 hover:underline"
            >
              {messages.disciplines[discipline]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Site header (FC 047), laid out like the big stores and dressed as Yekora: from left to right the
 * logo, where we deliver (only the postal code of the account), the product search, the account
 * menu (which also holds the language) and the cart; under the bar, the strip of disciplines. On a
 * phone the bar becomes rows: logo, account and cart; the search at full width; the delivery code.
 * No hamburger: everything a person needs has a place in view. The bar stays on screen while the
 * page scrolls; the strip of disciplines does not, so it never eats the height of a phone.
 * Every target is at least 44 px (FC 003 gate), and internal links use `next/link` (FC 043 T2.3).
 */
export function Header({ locale, messages }: Readonly<HeaderProps>) {
  return (
    <>
      <header className="sticky top-0 z-40 bg-petroleo text-marfil">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 md:flex-nowrap md:gap-x-4">
          <Link
            href={routeFor('home', locale)}
            aria-label={messages.brand.homeLink}
            className="tap-target order-1 mr-auto shrink-0 gap-3 md:mr-0"
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
          </Link>
          <div className="order-5 md:order-2">
            <DeliveryIndicator
              accountHref={routeFor('account', locale)}
              registerHref={`${routeFor('account', locale)}?action=register`}
              messages={messages.header.delivery}
            />
          </div>
          <div className="order-4 w-full md:order-3 md:w-auto md:flex-1">
            <SearchCombobox
              locale={locale}
              action={routeFor('catalog', locale)}
              indexUrl={searchIndexPath(locale)}
              messages={messages.header.search}
            />
          </div>
          <div className="order-2 md:order-4">
            <AccountMenu
              locale={locale}
              area={routeFor('account', locale)}
              messages={messages.header}
              dashboard={messages.account.dashboard}
              languageMessages={messages.languageSwitcher}
            />
          </div>
          <div className="order-3 md:order-5">
            <CartButton
              locale={locale}
              messages={messages.cart}
              priceMessages={messages.catalog.price}
            />
          </div>
        </div>
      </header>
      <DisciplineBar locale={locale} messages={messages} />
    </>
  );
}
