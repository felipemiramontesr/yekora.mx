'use client';

import { type SubmitEvent, useCallback, useEffect, useState } from 'react';
import type { Locale, Messages } from '@/app/i18n';
import {
  MAX_CENTS,
  type ShippingAdminView,
} from '@/lib/account/shippingAdminTypes';
import {
  readShippingAdmin,
  type ShippingAdminFailure,
  saveShippingConfig,
  saveShippingRules,
} from '@/lib/api/shippingAdminClient';
import { fill } from '@/lib/catalog/format';
import { Field } from '../ui/Field';

/** `account.shipping` texts. */
export type ShippingAdminTexts = Messages['account']['shipping'];

/** What the console says after an action: a confirmation or the refusal. */
type Note = { kind: 'ok' | 'error'; text: string } | null;

/** A text field, like the checkout's. */
const FIELD = 'min-h-11 rounded-md border border-petroleo/30 bg-white px-3';

/** An amount in pesos as typed: digits with up to two decimals. */
const PESOS = /^\d+(\.\d{1,2})?$/;

/** The message of a refusal: the console names each code; anything else is generic. */
function failureText(texts: ShippingAdminTexts, reason: ShippingAdminFailure) {
  return reason in texts.errors
    ? texts.errors[reason as keyof ShippingAdminTexts['errors']]
    : texts.errors.unknown;
}

/** Cents as the pesos a person types, always with two decimals. */
function pesosOf(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * The cents of an amount typed in pesos.
 *
 * @param text - What was typed.
 * @returns Whole cents, or null when it is not an amount from 0 to the guard.
 */
function centsOf(text: string): number | null {
  const typed = text.trim();
  if (!PESOS.test(typed)) return null;
  const cents = Math.round(Number(typed) * 100);
  return cents <= MAX_CENTS ? cents : null;
}

/** The drafts a view starts from: the typed rate of each state. */
function draftsOf(view: ShippingAdminView): Record<number, string> {
  return Object.fromEntries(
    view.rules.map((rule) => [rule.zoneId, pesosOf(rule.rateMxnCents)])
  );
}

/**
 * The shipping console of `{area}envios/` (FC 061 F1): shown only to an account with
 * `shipping:manage`, and only as a convenience, since the API refuses everyone else. It shows the
 * active strategy, lets the administrator switch free shipping on or off with its threshold, and
 * edit the rate of each of the 32 states. Amounts are typed in pesos and travel as whole cents.
 *
 * @param texts - `account.shipping` texts.
 * @param locale - Language of the page, for the names of the states.
 */
export function ShippingAdminConsole({
  texts,
  locale,
}: Readonly<{ texts: ShippingAdminTexts; locale: Locale }>) {
  const [view, setView] = useState<ShippingAdminView | null>(null);
  const [freeOn, setFreeOn] = useState(false);
  const [threshold, setThreshold] = useState('');
  const [rates, setRates] = useState<Record<number, string>>({});
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);

  /** Shows a view: its drafts replace what was typed. */
  const show = useCallback((next: ShippingAdminView) => {
    setView(next);
    setFreeOn(next.config.isFreeShippingActive);
    setThreshold(
      next.config.freeShippingThresholdMxnCents === null
        ? ''
        : pesosOf(next.config.freeShippingThresholdMxnCents)
    );
    setRates(draftsOf(next));
  }, []);

  useEffect(() => {
    let current = true;
    void readShippingAdmin().then((result) => {
      if (!current) return;
      if (result.ok) show(result.data);
      else setNote({ kind: 'error', text: failureText(texts, result.reason) });
    });
    return () => {
      current = false;
    };
  }, [show, texts]);

  /** Runs one write, then shows the view it answers and says how it went. */
  async function run(write: () => ReturnType<typeof saveShippingConfig>) {
    setBusy(true);
    const result = await write();
    setBusy(false);
    if (!result.ok) {
      setNote({ kind: 'error', text: failureText(texts, result.reason) });
      return;
    }
    show(result.data);
    setNote({ kind: 'ok', text: texts.saved });
  }

  if (view === null) {
    return note ? (
      <output className="block text-red-800">{note.text}</output>
    ) : (
      <output className="block">{texts.loading}</output>
    );
  }

  const strategy = view.strategies.find(
    (entry) => entry.id === view.config.strategyId
  );
  const strategyName = locale === 'en' ? strategy?.nameEn : strategy?.nameEs;

  function saveFree(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const cents = freeOn ? centsOf(threshold) : null;
    if (freeOn && (cents === null || cents === 0)) {
      setNote({ kind: 'error', text: texts.invalidAmount });
      return;
    }
    void run(() =>
      saveShippingConfig({
        strategyId: (view as ShippingAdminView).config.strategyId,
        isFreeShippingActive: freeOn,
        freeShippingThresholdMxnCents: cents,
      })
    );
  }

  function saveRates(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = (view as ShippingAdminView).zones.map((zone) => ({
      zoneId: zone.id,
      cents: centsOf(rates[zone.id] ?? ''),
    }));
    if (typed.some((entry) => entry.cents === null)) {
      setNote({ kind: 'error', text: texts.invalidAmount });
      return;
    }
    void run(() =>
      saveShippingRules({
        rules: typed.map((entry) => ({
          zoneId: entry.zoneId,
          rateMxnCents: entry.cents as number,
        })),
      })
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <p className="max-w-2xl">{texts.intro}</p>
      {note && (
        <output
          className={`block ${note.kind === 'error' ? 'text-red-800' : ''}`}
        >
          {note.text}
        </output>
      )}
      <div className="flex max-w-2xl flex-col gap-2">
        <h2 className="text-lg font-semibold">{texts.strategyTitle}</h2>
        <p>{fill(texts.strategyActive, { name: strategyName ?? '' })}</p>
        <p className="text-sm text-petroleo/80">{texts.strategyNote}</p>
      </div>
      <form
        onSubmit={saveFree}
        className="flex max-w-xl flex-col gap-3"
        aria-label={texts.freeTitle}
      >
        <h2 className="text-lg font-semibold">{texts.freeTitle}</h2>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={freeOn}
            onChange={(event) => setFreeOn(event.target.checked)}
            className="size-5"
          />
          {texts.freeToggle}
        </label>
        {freeOn && (
          <Field
            id="shipping-threshold"
            label={texts.freeThreshold}
            description={texts.freeDescription}
            example={texts.freeExample}
            exampleLabel={texts.exampleLabel}
          >
            {(control) => (
              <input
                {...control}
                name="threshold"
                inputMode="decimal"
                autoComplete="off"
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
                className={FIELD}
              />
            )}
          </Field>
        )}
        <button
          type="submit"
          disabled={busy}
          className="tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60"
        >
          {busy ? texts.saving : texts.saveFree}
        </button>
      </form>
      <form
        onSubmit={saveRates}
        className="flex flex-col gap-3"
        aria-label={texts.ratesTitle}
      >
        <h2 className="text-lg font-semibold">{texts.ratesTitle}</h2>
        <p className="max-w-2xl text-sm">{texts.ratesIntro}</p>
        <div className="overflow-x-auto">
          <table className="w-full max-w-xl text-left text-sm">
            <caption className="sr-only">{texts.caption}</caption>
            <thead>
              <tr>
                <th scope="col">{texts.state}</th>
                <th scope="col">{texts.rate}</th>
              </tr>
            </thead>
            <tbody>
              {view.zones.map((zone) => {
                const name = locale === 'en' ? zone.nameEn : zone.nameEs;
                return (
                  <tr key={zone.id}>
                    <th scope="row" className="font-normal">
                      {name}
                    </th>
                    <td>
                      <input
                        name={`rate-${zone.code}`}
                        inputMode="decimal"
                        autoComplete="off"
                        aria-label={fill(texts.rateFor, { state: name })}
                        value={rates[zone.id] ?? ''}
                        onChange={(event) =>
                          setRates((current) => ({
                            ...current,
                            [zone.id]: event.target.value,
                          }))
                        }
                        className={`${FIELD} w-32`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60"
        >
          {busy ? texts.saving : texts.saveRates}
        </button>
      </form>
    </section>
  );
}
