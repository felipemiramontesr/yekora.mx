import { getMessages, type Locale } from '@/app/i18n';
import { AccountApp } from '../account/AccountApp';

/**
 * Account page body, shared by `/cuenta/` and `/en/account/` (FC 028 F2). Everything below the
 * heading is client-rendered: the prerendered page carries the heading and a loading line, and
 * hydrates with the session.
 *
 * @param locale - Language of the page.
 */
export function AccountView({ locale }: Readonly<{ locale: Locale }>) {
  const { account, checkout } = getMessages(locale);
  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-4xl font-semibold">{account.title}</h1>
      <div className="mt-8">
        <AccountApp
          locale={locale}
          messages={account}
          methods={checkout.method.options}
        />
      </div>
    </div>
  );
}
