'use client';

import { useEffect, useState } from 'react';
import {
  recallDeliveryPostal,
  rememberDeliveryPostal,
} from '@/lib/delivery/deliveryPostal';
import {
  hasLocationConsent,
  subscribeLocationConsent,
} from '@/lib/delivery/locationConsent';
import { postalCodeOf } from '@/lib/delivery/reverseGeocode';

/** Longest the browser may take to give the position before the indicator stays silent. */
const POSITION_TIMEOUT_MS = 10_000;
/** A position this old is good enough: a postal code does not change while someone browses. */
const POSITION_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * The postal code of where the browser is (FC 055 T1.2, T2.6 to T2.8, Enmienda 1). It asks the
 * browser for the position only when `enabled` and only after the visitor said «yes» in the
 * cookie notice, so the permission prompt is never a surprise. Whatever fails (permission denied,
 * no support, timeout, a geocoder that names no code) leaves it at null: the header stays silent
 * and nobody is asked anything. A code resolved earlier in this tab is reused from session
 * storage; the coordinates are handed to the geocoder and then dropped.
 *
 * @param enabled - False while the account, if any, still has a postal code of its own or is being confirmed.
 * @returns The five-digit postal code, or null.
 */
export function useDeliveryLocation(enabled: boolean): string | null {
  const [postal, setPostal] = useState<string | null>(null);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    setAllowed(hasLocationConsent());
    return subscribeLocationConsent(() => setAllowed(hasLocationConsent()));
  }, []);

  useEffect(() => {
    if (!enabled || !allowed) {
      setPostal(null);
      return;
    }
    const remembered = recallDeliveryPostal();
    if (remembered !== null) {
      setPostal(remembered);
      return;
    }
    if (!('geolocation' in globalThis.navigator)) return;
    const controller = new AbortController();
    globalThis.navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        void postalCodeOf(coords, controller.signal).then((code) => {
          if (code === null || controller.signal.aborted) return;
          rememberDeliveryPostal(code);
          setPostal(code);
        });
      },
      () => undefined, // denied or unavailable: silent, no question
      { timeout: POSITION_TIMEOUT_MS, maximumAge: POSITION_MAX_AGE_MS }
    );
    return () => controller.abort();
  }, [enabled, allowed]);

  return enabled && allowed ? postal : null;
}
