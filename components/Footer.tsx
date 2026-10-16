import { disciplines, type Locale, type Messages } from '@/app/i18n';
import { routeFor } from '@/lib/routes';

interface FooterProps {
  locale: Locale;
  messages: Messages;
}

export function Footer({ locale, messages }: Readonly<FooterProps>) {
  const { footer } = messages;
  const legal = [
    { href: routeFor('privacy', locale), label: footer.privacy },
    { href: routeFor('cookies', locale), label: footer.cookies },
    { href: routeFor('terms', locale), label: footer.terms },
  ];
  return (
    <footer className="bg-petroleo text-marfil">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-4">
        <div className="flex flex-col gap-4">
          {/* Horizontal lockup from the client's individual elements: isotype, then name over descriptor. */}
          <div className="flex items-center gap-4">
            <img
              src="/brand/elements/YEKORA_01_ISOTIPO_MARFIL.svg"
              alt={messages.brand.logoAlt}
              width={49}
              height={56}
            />
            <div className="flex flex-col gap-2">
              <img
                src="/brand/elements/YEKORA_02_NOMBRE_MARFIL.svg"
                alt=""
                width={123}
                height={22}
              />
              <img
                src="/brand/elements/YEKORA_03_TIENDA_OUTDOOR_MARFIL.svg"
                alt=""
                width={113}
                height={8}
              />
            </div>
          </div>
          <p className="text-sm text-marfil/90">{footer.tagline}</p>
        </div>
        <nav aria-label={footer.disciplinesTitle}>
          <h2 className="text-sm font-semibold inline-block border-b-2 border-ocre pb-1 uppercase tracking-widest">
            {footer.disciplinesTitle}
          </h2>
          <ul className="mt-2 flex flex-col text-sm">
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
          </ul>
        </nav>
        <div>
          <h2 className="text-sm font-semibold inline-block border-b-2 border-ocre pb-1 uppercase tracking-widest">
            {footer.companyTitle}
          </h2>
          <ul className="mt-2 flex flex-col text-sm">
            <li>
              <a
                href={routeFor('about', locale)}
                className="tap-target underline-offset-4 hover:underline"
              >
                {messages.header.about}
              </a>
            </li>
            <li className="text-marfil/90">{footer.mexicanTalent}</li>
          </ul>
        </div>
        <nav aria-label={footer.legalTitle}>
          <h2 className="text-sm font-semibold inline-block border-b-2 border-ocre pb-1 uppercase tracking-widest">
            {footer.legalTitle}
          </h2>
          <ul className="mt-2 flex flex-col text-sm">
            {legal.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="tap-target underline-offset-4 hover:underline"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <p className="border-t border-marfil/15 py-6 text-center text-xs text-marfil/80">
        © {new Date().getFullYear()} {messages.brand.name}. {footer.rights}
      </p>
    </footer>
  );
}
