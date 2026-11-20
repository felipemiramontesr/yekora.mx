'use client';

import { MapPin } from 'lucide-react';
import Link from 'next/link';
import type { Messages } from '@/app/i18n';
import { fill } from '@/lib/catalog/format';
import { useDeliveryLocation } from './useDeliveryLocation';
import { useHeaderAccount } from './useHeaderAccount';

/**
 * Where the store delivers, in the header (FC 047 T1.1, T2.1; FC 055 T1.2, T2.4, Enmienda 1), the
 * way Amazon shows it: a pin and a postal code, and never a question.
 *
 * - An account with a default delivery address shows that address's code, as `GET /v1/account/me`
 *   hands it back; it is never kept in the browser (FC 047 T2.3). Until the API confirms the
 *   session a placeholder holds its place so the bar does not jump.
 * - Anyone else (an account without an address, or a visitor) sees the code of where the browser
 *   is, when they allowed it in the cookie notice and the browser agreed (useDeliveryLocation).
 * - If there is no code, nothing is shown: no link, no invitation, no alert.
 *
 * @param accountHref - Where the delivery addresses are kept, in the page's language: the data and
 *   addresses of the account area (FC 051), which is where an account changes its postal code.
 * @param messages - `header.delivery` texts.
 */
export function DeliveryIndicator({
  accountHref,
  messages,
}: Readonly<{
  accountHref: string;
  messages: Messages['header']['delivery'];
}>) {
  const { firstName, user } = useHeaderAccount();
  // The location is only asked when no address will answer: a confirmed account without a
  // postal code, or a visitor (no hint of a session).
  const located = useDeliveryLocation(
    user ? !user.postalCode : firstName === null
  );
  const pin = (
    <MapPin aria-hidden="true" size={20} className="shrink-0 text-ocre" />
  );
  const style = 'tap-target gap-1.5 text-sm font-semibold';
  const code = user?.postalCode ?? located;

  if (code && user) {
    return (
      <Link
        href={accountHref}
        aria-label={fill(messages.to, { code })}
        className={style}
      >
        {pin}
        <span aria-hidden="true">{code}</span>
      </Link>
    );
  }
  if (code) {
    return (
      <span className={style}>
        {pin}
        <span className="sr-only">{fill(messages.to, { code })}</span>
        <span aria-hidden="true">{code}</span>
      </span>
    );
  }
  if (firstName !== null && !user) {
    // The session is being confirmed: hold the place of the code without announcing anything.
    return (
      <span aria-hidden="true" className={`${style} opacity-60`}>
        {pin}
        <span className="inline-block h-4 w-12 rounded bg-marfil/20" />
      </span>
    );
  }
  return null;
}
