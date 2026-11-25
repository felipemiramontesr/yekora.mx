'use client';

import { type SubmitEvent, useId, useState } from 'react';
import type { Locale, Messages } from '@/app/i18n';
import type { OrderDetail } from '@/lib/account/orderTypes';
import {
  canRequestReturn,
  returnableUnits,
  returnWindowEndsAt,
} from '@/lib/account/returnRules';
import type { ReturnRequest } from '@/lib/account/returnTypes';
import { requestReturn, type ReturnsFailure } from '@/lib/api/returnsClient';
import { fill } from '@/lib/catalog/format';
import { Field } from '../ui/Field';
import { TextField } from '../ui/TextField';

/** `account.returnRequest` texts. */
type ReturnRequestTexts = Messages['account']['returnRequest'];

/** The reasons the buyer may give, in the order the list offers them. */
const REASONS = ['DEFECT', 'NOT_AS_DESCRIBED', 'CHANGED_MIND'] as const;

/** What the page says after sending, or when something is missing. */
type Note = { kind: 'ok' | 'error'; text: string } | null;

/** The button of a step. */
const BUTTON =
  'tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60';

/** The control of a select or a text area, like the text fields'. */
const CONTROL =
  'min-h-11 rounded-md border border-petroleo/30 bg-white px-3 aria-invalid:border-red-700';

/** The message of a refusal: the page names each code; anything else is generic. */
function failureText(texts: ReturnRequestTexts, reason: ReturnsFailure) {
  return reason in texts.errors
    ? texts.errors[reason as keyof ReturnRequestTexts['errors']]
    : texts.errors.unknown;
}

/** The day the window closes, as a date in the page's language. */
function deadlineOf(deliveredAt: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeZone: 'America/Mexico_City',
  }).format(returnWindowEndsAt(deliveredAt));
}

/**
 * «Solicitar devolución» on the buyer's order page (FC 073 F2, K-80 second part, T1.1): offered
 * only for a delivered order inside the window of 60 natural days that still has units to return.
 * The buyer chooses how many pieces of each line come back, why, and may add a comment; the API
 * (FC 071) decides again and its refusal is the one that counts. When the request is sent the
 * page says so and asks the order to be read again, so the units already asked disappear from
 * the offer.
 *
 * @param order - The order as the buyer reads it.
 * @param texts - `account.returnRequest` texts.
 * @param locale - Language of the page, for the closing date of the window.
 * @param exampleLabel - The word that introduces the example of a field.
 * @param onDone - Called after a request was sent, so the order is read again.
 */
export function OrderReturnRequest({
  order,
  texts,
  locale,
  exampleLabel,
  onDone,
}: Readonly<{
  order: OrderDetail;
  texts: ReturnRequestTexts;
  locale: Locale;
  exampleLabel: string;
  onDone: () => void;
}>) {
  const base = useId();
  const [open, setOpen] = useState(false);
  const [units, setUnits] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const offered = canRequestReturn(order, new Date());
  const lines = order.lines.filter((line) => returnableUnits(line) > 0);

  /** The lines the buyer chose, or why the choice is not valid. */
  function chosen(): ReturnRequest['items'] | 'quantity' | 'none' {
    const items: ReturnRequest['items'] = [];
    for (const line of lines) {
      const typed = (units[line.sku] ?? '').trim();
      if (typed === '' || typed === '0') continue;
      const quantity = Number(typed);
      if (
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > returnableUnits(line)
      ) {
        return 'quantity';
      }
      items.push({ sku: line.sku, quantity });
    }
    return items.length === 0 ? 'none' : items;
  }

  async function send(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const items = chosen();
    if (items === 'quantity') {
      setNote({ kind: 'error', text: texts.invalidQuantity });
      return;
    }
    if (items === 'none') {
      setNote({ kind: 'error', text: texts.chooseOne });
      return;
    }
    const why = REASONS.find((name) => name === reason);
    if (why === undefined) {
      setNote({ kind: 'error', text: texts.chooseReason });
      return;
    }
    const remark = comment.trim();
    setBusy(true);
    const result = await requestReturn(order.orderNumber, {
      items,
      reason: why,
      ...(remark === '' ? {} : { comment: remark }),
    });
    setBusy(false);
    if (!result.ok) {
      setNote({ kind: 'error', text: failureText(texts, result.reason) });
      return;
    }
    setOpen(false);
    setUnits({});
    setReason('');
    setComment('');
    setNote({ kind: 'ok', text: texts.sent });
    onDone();
  }

  if (!offered && note === null) return null;
  return (
    <section
      aria-label={texts.title}
      className="mt-4 flex max-w-xl flex-col gap-4 border-t border-petroleo/15 pt-4"
    >
      {note && (
        <output
          className={`block ${note.kind === 'error' ? 'text-red-800' : ''}`}
        >
          {note.text}
        </output>
      )}
      {offered && !open && (
        <button
          type="button"
          onClick={() => {
            setNote(null);
            setOpen(true);
          }}
          className={BUTTON}
        >
          {texts.open}
        </button>
      )}
      {offered && open && (
        <form
          noValidate
          onSubmit={(event) => void send(event)}
          aria-label={texts.title}
          className="flex flex-col gap-4"
        >
          <h3 className="text-lg font-semibold">{texts.title}</h3>
          <p>{texts.intro}</p>
          <p className="text-sm text-petroleo/80">
            {fill(texts.window, {
              // The offer exists only for a delivered order, so the date is there.
              date: deadlineOf(order.deliveredAt as string, locale),
            })}
          </p>
          {lines.map((line) => (
            <TextField
              key={line.sku}
              id={`${base}-units-${line.sku}`}
              label={fill(texts.unitsFor, {
                sku: line.sku,
                max: returnableUnits(line),
              })}
              description={fill(texts.fields.units.description, {
                max: returnableUnits(line),
              })}
              example={texts.fields.units.example}
              exampleLabel={exampleLabel}
              input={{
                type: 'number',
                min: 0,
                max: returnableUnits(line),
                inputMode: 'numeric',
                autoComplete: 'off',
                value: units[line.sku] ?? '',
                onChange: (event) =>
                  setUnits((now) => ({
                    ...now,
                    [line.sku]: event.target.value,
                  })),
              }}
            />
          ))}
          <Field
            id={`${base}-reason`}
            label={texts.reasonLabel}
            {...texts.fields.reason}
            exampleLabel={exampleLabel}
          >
            {(control) => (
              <select
                {...control}
                className={CONTROL}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              >
                <option value="">{texts.reasonPlaceholder}</option>
                {REASONS.map((name) => (
                  <option key={name} value={name}>
                    {texts.reasons[name]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id={`${base}-comment`}
            label={texts.commentLabel}
            {...texts.fields.comment}
            exampleLabel={exampleLabel}
          >
            {(control) => (
              <textarea
                {...control}
                className={`${CONTROL} py-2`}
                rows={3}
                maxLength={500}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy} className={BUTTON}>
              {busy ? texts.sending : texts.submit}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setNote(null);
              }}
              className="tap-target self-start rounded-lg border border-petroleo/40 px-5 font-semibold"
            >
              {texts.cancel}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
