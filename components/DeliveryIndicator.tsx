'use client';

import { MapPin } from 'lucide-react';
import Link from 'next/link';
import type { Messages } from '@/app/i18n';
import { fill } from '@/lib/catalog/format';
import { useHeaderAccount } from './useHeaderAccount';

/**
 * Where the store delivers, in the header (FC 047 T1.1, T2.1; FC 051): a pin and only the postal code
 * of the default delivery address of the account, as `GET /v1/account/me` hands it back to them. It is never kept
 * in the browser (T2.3): it appears once the API confirms the session, and while it is confirmed a
 * placeholder holds its place so the bar does not jump. A visitor, or an account with no address yet,
 * sees a short invitation instead, which leads where it can be given.
 *
 * @param accountHref - Where the delivery addresses are kept, in the page's language: the data and
 *   addresses of the account area (FC 051), which is also where a postal code is added or changed.
 * @param registerHref - The sign-up form in the page's language.
 * @param messages - `header.delivery` texts.
 */
export function DeliveryIndicator({
  accountHref,
  registerHref,
  messages,
}: Readonly<{
  accountHref: string;
  registerHref: string;
  messages: Messages['header']['delivery'];
}>) {
  const { firstName, user } = useHeaderAccount();
  const pin = (
    <MapPin aria-hidden="true" size={20} className="shrink-0 text-ocre" />
  );
  const style = 'tap-target gap-1.5 text-sm font-semibold';

  if (user?.postalCode) {
    return (
      <Link
        href={accountHref}
        aria-label={fill(messages.to, { code: user.postalCode })}
        className={style}
      >
        {pin}
        <span aria-hidden="true">{user.postalCode}</span>
      </Link>
    );
  }
  if (user) {
    return (
      <Link
        href={accountHref}
        title={messages.addHint}
        className={`${style} underline decoration-ocre underline-offset-4`}
      >
        {pin}
        {messages.add}
      </Link>
    );
  }
  if (firstName !== null) {
    // The session is being confirmed: hold the place of the code without announcing anything.
    return (
      <span aria-hidden="true" className={`${style} opacity-60`}>
        {pin}
        <span className="inline-block h-4 w-12 rounded bg-marfil/20" />
      </span>
    );
  }
  return (
    <Link
      href={registerHref}
      title={messages.guestHint}
      className={`${style} underline decoration-ocre underline-offset-4`}
    >
      {pin}
      {messages.guest}
    </Link>
  );
}
