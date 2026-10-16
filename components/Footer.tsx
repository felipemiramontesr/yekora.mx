import { disciplines, type Locale, type Messages } from '@/app/i18n';

interface FooterProps {
  locale: Locale;
  messages: Messages;
}

export function Footer({ locale, messages }: Readonly<FooterProps>) {
  const { footer } = messages;
  const legal = [
    { href: `/${locale}/privacidad`, label: footer.privacy },
    { href: `/${locale}/cookies`, label: footer.cookies },
    { href: `/${locale}/terminos`, label: footer.terms },
  ];
  return (
    <footer className="bg-petroleo text-marfil">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-4">
        <div className="flex flex-col gap-4">
          <img
            src="/brand/YEKORA_logo_vectorial_marfil.svg"
            alt={messages.brand.logoAlt}
            width={140}
            height={114}
          />
          <p className="text-sm text-marfil/90">{footer.tagline}</p>
        </div>
        <nav aria-label={footer.disciplinesTitle}>
          <h2 className="text-sm font-semibold inline-block border-b-2 border-ocre pb-1 uppercase tracking-widest">
            {footer.disciplinesTitle}
          </h2>
          <ul className="mt-4 flex flex-col gap-2 text-sm">
            {disciplines.map((discipline) => (
              <li key={discipline}>
                <a
                  href={`/${locale}#${discipline}`}
                  className="underline-offset-4 hover:underline"
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
          <ul className="mt-4 flex flex-col gap-2 text-sm">
            <li>
              <a
                href={`/${locale}/nosotros`}
                className="underline-offset-4 hover:underline"
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
          <ul className="mt-4 flex flex-col gap-2 text-sm">
            {legal.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="underline-offset-4 hover:underline"
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
