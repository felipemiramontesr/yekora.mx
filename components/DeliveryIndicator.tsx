'use client';

import { MapPin } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Locale, Messages } from '@/app/i18n';
import { firstNameOf } from '@/lib/account/sessionHint';
import { MEXICAN_STATES } from '@/lib/cart/mxStates';
import { stateOfPostalCode } from '@/lib/cart/postalRanges';
import { fill } from '@/lib/catalog/format';
import { abbreviationOf } from '@/lib/delivery/stateAbbreviations';
import { DeliveryLocationModal } from './DeliveryLocationModal';
import { useDeliveryLocation } from './useDeliveryLocation';
import { useHeaderAccount } from './useHeaderAccount';

/** What the second line shows for a place, and how it is read aloud. */
function describe(
  place: string,
  locale: Locale
): { shown: string; spoken: string } {
  // A state code alone is all that is known; a postal code carries its state with it.
  const alone = MEXICAN_STATES.find(({ code }) => code === place);
  const state =
    alone ??
    MEXICAN_STATES.find(({ code }) => code === stateOfPostalCode(place));
  const code = alone ? '' : place;
  const named = state
    ? {
        shown: abbreviationOf(state.code),
        spoken: state[locale === 'en' ? 'en' : 'es'],
      }
    : null;
  return {
    shown: [named?.shown, code].filter(Boolean).join(' '),
    spoken: [named?.spoken, code].filter(Boolean).join(' '),
  };
}

/**
 * Where the store delivers, in the header (FC 047, FC 055, FC 078): two lines from `md` and a thin
 * strip of one line on a phone, always a button that opens «Where do we deliver?».
 *
 * - An account with a default delivery address shows its state and postal code, as `GET
 *   /v1/account/me` hands it back; it is never kept in the browser (FC 047 T2.3).
 * - Anyone else shows what this tab holds: the code they typed, or where the browser is when they
 *   allowed it (useDeliveryLocation).
 * - With nothing, it invites to enter a postal code (an amendment to FC 055 Ω agreed to). It never
 *   opens by itself and promises no delivery date.
 * - Its box has a fixed size, so nothing jumps while the account or the location is resolved.
 *
 * @param accountHref - Where the delivery addresses are kept, in the page's language.
 * @param locale - Language of the page, for the full name of a state.
 * @param messages - `header.delivery` texts.
 * @param exampleLabel - The word that introduces an example.
 */
export function DeliveryIndicator({
  accountHref,
  locale,
  messages,
  exampleLabel,
}: Readonly<{
  accountHref: string;
  locale: Locale;
  messages: Messages['header']['delivery'];
  exampleLabel: string;
}>) {
  const { firstName, user } = useHeaderAccount();
  const { place: located, resolving } = useDeliveryLocation(
    user ? !user.postalCode : firstName === null
  );
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => setMounted(true), []);

  const name = user ? firstNameOf(user.fullName) : firstName;
  const place = user?.postalCode ?? located;
  // Prerendered, being confirmed or being located: the box is held, with nothing to read.
  const waiting =
    !mounted ||
    (place === null && (resolving || (firstName !== null && !user)));
  const known = place === null ? null : describe(place, locale);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        disabled={!mounted}
        onClick={() => setOpen(true)}
        className="tap-target h-11 w-full justify-start gap-1.5 text-left md:w-36 lg:w-44"
      >
        <MapPin aria-hidden="true" size={20} className="shrink-0 text-ocre" />
        <span className="flex min-w-0 flex-1 items-baseline gap-1 md:flex-col md:items-start md:gap-0">
          <span className="min-w-0 truncate text-xs text-marfil/80 md:max-w-full">
            {name ? fill(messages.toName, { name }) : messages.label}
          </span>
          <span aria-hidden="true" className="text-marfil/60 md:hidden">
            ·
          </span>
          {waiting ? (
            <span
              aria-hidden="true"
              className="inline-block h-4 w-16 shrink-0 rounded bg-marfil/20"
            />
          ) : (
            <span className="shrink-0 whitespace-nowrap text-sm font-semibold">
              {known ? (
                <>
                  <span aria-hidden="true">{known.shown}</span>
                  <span className="sr-only">{known.spoken}</span>
                </>
              ) : (
                messages.enter
              )}
            </span>
          )}
        </span>
      </button>
      {open && (
        <DeliveryLocationModal
          texts={messages}
          exampleLabel={exampleLabel}
          signedIn={user !== null}
          accountHref={accountHref}
          onClose={close}
        />
      )}
    </>
  );
}
