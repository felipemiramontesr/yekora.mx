'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  recallDeliveryPlace,
  rememberDeliveryPlace,
  subscribeDeliveryPlace,
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
 * Where this tab delivers when no saved address says it (FC 055 T1.2, T2.6 to T2.9; FC 078 T2.6).
 *
 * What the person typed in the header, or what was resolved before, is shown whether or not they
 * agreed to the location: it is read from session storage and followed as it changes. Only asking
 * the browser for its position needs `enabled` and the «yes» of the cookie notice, so the
 * permission prompt is never a surprise; a postal code typed meanwhile wins over what the browser
 * answers. Whatever fails (permission denied, no support, timeout, a geocoder that names no code)
 * leaves it at null, and nobody is asked anything. The coordinates are handed to the geocoder and
 * then dropped.
 *
 * @param enabled - False while the account, if any, still has a postal code of its own.
 * @returns `place`: five digits (a postal code), the code of a state of the closed list (`ZAC`), or
 *   null; and `resolving`: true from the visitor's «yes» until the position and the geocoders have
 *   answered, so the header can show that it is working instead of looking frozen.
 */
export function useDeliveryLocation(enabled: boolean): {
  place: string | null;
  resolving: boolean;
} {
  const kept = useSyncExternalStore(
    subscribeDeliveryPlace,
    recallDeliveryPlace,
    () => null
  );
  const [detected, setDetected] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    setAllowed(hasLocationConsent());
    return subscribeLocationConsent(() => setAllowed(hasLocationConsent()));
  }, []);

  useEffect(() => {
    if (!enabled || !allowed || recallDeliveryPlace() !== null) {
      setResolving(false);
      return;
    }
    if (!('geolocation' in globalThis.navigator)) return;
    const controller = new AbortController();
    setResolving(true);
    const done = () => {
      if (!controller.signal.aborted) setResolving(false);
    };
    globalThis.navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        // A state known at once is shown at once; a postal code that follows replaces it.
        const early = (state: string) => {
          if (controller.signal.aborted) return;
          setDetected(state);
          setResolving(false);
        };
        void placeOf(coords, controller.signal, undefined, early).then(
          (found) => {
            // What the person typed while this was resolving is not overwritten.
            if (
              found !== null &&
              !controller.signal.aborted &&
              recallDeliveryPlace() === null
            ) {
              setDetected(found);
              rememberDeliveryPlace(found);
            }
            done();
          }
        );
      },
      done, // denied or unavailable: silent, no question
      { timeout: POSITION_TIMEOUT_MS, maximumAge: POSITION_MAX_AGE_MS }
    );
    return () => controller.abort();
  }, [enabled, allowed]);

  if (!enabled) return { place: null, resolving: false };
  return {
    place: kept ?? (allowed ? detected : null),
    resolving: kept === null && allowed && resolving,
  };
}
