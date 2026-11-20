'use client';

import { MapPin } from 'lucide-react';
import Link from 'next/link';
import type { Locale, Messages } from '@/app/i18n';
import { MEXICAN_STATES } from '@/lib/cart/mxStates';
import { fill } from '@/lib/catalog/format';
import { abbreviationOf } from '@/lib/delivery/stateAbbreviations';
import { useDeliveryLocation } from './useDeliveryLocation';
import { useHeaderAccount } from './useHeaderAccount';

/**
 * Where the store delivers, in the header (FC 047 T1.1, T2.1; FC 055 T1.2, T2.4, Enmienda 1), the
 * way Amazon shows it: a pin and a postal code, and never a question.
 *
 * - An account with a default delivery address shows that address's code, as `GET /v1/account/me`
 *   hands it back; it is never kept in the browser (FC 047 T2.3). Until the API confirms the
 *   session a placeholder holds its place so the bar does not jump.
 * - Anyone else (an account without an address, or a visitor) sees where the browser is, when
 *   they allowed it in the cookie notice and the browser agreed (useDeliveryLocation): the postal
 *   code or, where no service knows one (the countryside), the state by its usual abbreviation
 *   («Enviar a Zac.», FC 055 T2.9), which is only a reference and fixes no shipping (T2.10).
 * - While the location is being resolved a placeholder holds the place; if there is nothing in
 *   the end, nothing is shown: no link, no invitation, no alert.
 *
 * @param accountHref - Where the delivery addresses are kept, in the page's language: the data and
 *   addresses of the account area (FC 051), which is where an account changes its postal code.
 * @param locale - Language of the page, for the full name of a state.
 * @param messages - `header.delivery` texts.
 */
export function DeliveryIndicator({
  accountHref,
  locale,
  messages,
}: Readonly<{
  accountHref: string;
  locale: Locale;
  messages: Messages['header']['delivery'];
}>) {
  const { firstName, user } = useHeaderAccount();
  // The location is only asked when no address will answer: a confirmed account without a
  // postal code, or a visitor (no hint of a session).
  const { place: located, resolving } = useDeliveryLocation(
    user ? !user.postalCode : firstName === null
  );
  const pin = (
    <MapPin aria-hidden="true" size={20} className="shrink-0 text-ocre" />
  );
  const style = 'tap-target gap-1.5 text-sm font-semibold';
  // A postal code is five digits; anything else here is the code of a state of the closed list.
  const place = user?.postalCode ?? located;
  const state = place
    ? MEXICAN_STATES.find(({ code }) => code === place)
    : undefined;
  const visible = state ? abbreviationOf(state.code) : place;
  const spoken = state
    ? fill(messages.toState, { state: state[locale === 'en' ? 'en' : 'es'] })
    : fill(messages.to, { code: place ?? '' });

  if (visible && user) {
    return (
      <Link href={accountHref} aria-label={spoken} className={style}>
        {pin}
        <span aria-hidden="true">{visible}</span>
      </Link>
    );
  }
  if (visible) {
    return (
      <span className={style}>
        {pin}
        <span className="sr-only">{spoken}</span>
        <span aria-hidden="true">{visible}</span>
      </span>
    );
  }
  if ((firstName !== null && !user) || resolving) {
    // The session is being confirmed, or the location is being resolved right after the «yes»:
    // hold the place of the code without announcing anything, so the bar does not look frozen.
    return (
      <span aria-hidden="true" className={`${style} opacity-60`}>
        {pin}
        <span className="inline-block h-4 w-12 rounded bg-marfil/20" />
      </span>
    );
  }
  return null;
}
