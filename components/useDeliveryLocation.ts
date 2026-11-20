'use client';

import { useEffect, useState } from 'react';
import {
  recallDeliveryPlace,
  rememberDeliveryPlace,
} from '@/lib/delivery/deliveryPlace';
import {
  hasLocationConsent,
  subscribeLocationConsent,
} from '@/lib/delivery/locationConsent';
import { placeOf } from '@/lib/delivery/reverseGeocode';

/** Longest the browser may take to give the position before the indicator stays silent. */
const POSITION_TIMEOUT_MS = 10_000;
/** A position this old is good enough: the place does not change while someone browses. */
const POSITION_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Where the browser is (FC 055 T1.2, T2.6 to T2.9, Enmienda 1): a postal code or, where none is
 * known, a Mexican state. It asks the
 * browser for the position only when `enabled` and only after the visitor said «yes» in the
 * cookie notice, so the permission prompt is never a surprise. Whatever fails (permission denied,
 * no support, timeout, a geocoder that names no code) leaves it at null: the header stays silent
 * and nobody is asked anything. A place resolved earlier in this tab is reused from session
 * storage; the coordinates are handed to the geocoder and then dropped.
 *
 * @param enabled - False while the account, if any, still has a postal code of its own or is being confirmed.
 * @returns Five digits (a postal code), the code of a state of the closed list (`ZAC`), or null.
 */
export function useDeliveryLocation(enabled: boolean): string | null {
  const [place, setPlace] = useState<string | null>(null);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    setAllowed(hasLocationConsent());
    return subscribeLocationConsent(() => setAllowed(hasLocationConsent()));
  }, []);

  useEffect(() => {
    if (!enabled || !allowed) {
      setPlace(null);
      return;
    }
    const remembered = recallDeliveryPlace();
    if (remembered !== null) {
      setPlace(remembered);
      return;
    }
    if (!('geolocation' in globalThis.navigator)) return;
    const controller = new AbortController();
    globalThis.navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        void placeOf(coords, controller.signal).then((found) => {
          if (found === null || controller.signal.aborted) return;
          rememberDeliveryPlace(found);
          setPlace(found);
        });
      },
      () => undefined, // denied or unavailable: silent, no question
      { timeout: POSITION_TIMEOUT_MS, maximumAge: POSITION_MAX_AGE_MS }
    );
    return () => controller.abort();
  }, [enabled, allowed]);

  return enabled && allowed ? place : null;
}
