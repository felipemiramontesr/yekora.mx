'use client';

import { type SubmitEvent, useEffect, useId, useState } from 'react';
import type { Locale, Messages } from '@/app/i18n';
import { boardActionsOf } from '@/lib/account/returnRules';
import type { ReturnView } from '@/lib/account/returnTypes';
import {
  confirmReturn,
  listReturns,
  prepareReturn,
  type ReturnsFailure,
} from '@/lib/api/returnsClient';
import { fill, formatMoney } from '@/lib/catalog/format';
import { Field } from '../ui/Field';
import { TextField } from '../ui/TextField';
import { when } from './AccountOrders';

/** `account.returns` texts. */
export type ReturnsTexts = Messages['account']['returns'];

/** The stages of a request, in the order the filter offers them. */
const STAGES = ['REQUESTED', 'PREPARED', 'REFUNDING', 'REFUNDED'] as const;

/** What the board says after an action, or about the list. */
type Note = { kind: 'ok' | 'error'; text: string } | null;

/** What loading the board gave. */
type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; total: number }
  | { kind: 'failed'; reason: ReturnsFailure };

/** An amount in pesos as typed: digits with up to two decimals. */
const PESOS = /^\d+(\.\d{1,2})?$/;

/** The most a refund may be, in cents, as the API caps it. */
const MAX_CENTS = 100_000_000;

/** The button of a step. */
const BUTTON =
  'tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60';

/** The quiet button next to it. */
const QUIET =
  'tap-target self-start rounded-lg border border-petroleo/40 px-5 font-semibold';

/** The message of a refusal: the board names each code; anything else is generic. */
function failureText(texts: ReturnsTexts, reason: ReturnsFailure) {
  return reason in texts.errors
    ? texts.errors[reason as keyof ReturnsTexts['errors']]
    : texts.errors.unknown;
}

/**
 * The cents of an amount typed in pesos.
 *
 * @param text - What was typed.
 * @returns Whole cents, or null when it is not an amount from 0.01 to the API's cap.
 */
function centsOf(text: string): number | null {
  const typed = text.trim();
  if (!PESOS.test(typed)) return null;
  const cents = Math.round(Number(typed) * 100);
  return cents >= 1 && cents <= MAX_CENTS ? cents : null;
}

/**
 * One request of the board with the step its stage offers (FC 073 F1, T1.2a and T1.2b): «Preparar»
 * on a request just asked, «Confirmar» on a prepared one (and «Reintentar» when the processor did
 * not confirm it), nothing on a refunded one. The board does not know who prepared, so the
 * control dual is the API's: when the same person confirms, the refusal is explained.
 */
function ReturnCard({
  item,
  texts,
  locale,
  grants,
  onChanged,
}: Readonly<{
  item: ReturnView;
  texts: ReturnsTexts;
  locale: Locale;
  grants: { canPrepare: boolean; canConfirm: boolean };
  onChanged: (next: ReturnView) => void;
}>) {
  const base = useId();
  const [form, setForm] = useState<'prepare' | 'confirm' | null>(null);
  const [amount, setAmount] = useState('');
  const [restock, setRestock] = useState(true);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const actions = boardActionsOf(item.status, grants);
  const cents = centsOf(amount);
  const confirmLabel =
    actions.confirm === 'retry' ? texts.retry : texts.confirm;
  const stepLabel = actions.prepare ? texts.prepare : confirmLabel;

  /** Runs one step: it says how it went and, when it applied, hands the request back. */
  async function run(
    step: () => ReturnType<typeof prepareReturn>,
    done: string
  ): Promise<void> {
    setBusy(true);
    const result = await step();
    setBusy(false);
    if (!result.ok) {
      setNote({ kind: 'error', text: failureText(texts, result.reason) });
      return;
    }
    setForm(null);
    setNote({ kind: 'ok', text: fill(done, { number: item.orderNumber }) });
    onChanged(result.data);
  }

  function prepare(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cents === null) {
      setNote({ kind: 'error', text: texts.invalidAmount });
      return;
    }
    void run(
      () => prepareReturn(item.id, { refundMxnCents: cents, restock }),
      texts.preparedDone
    );
  }

  function confirm(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = reference.trim();
    void run(
      () =>
        confirmReturn(item.id, typed === '' ? {} : { manualReference: typed }),
      texts.confirmedDone
    );
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-petroleo/20 bg-white/60 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">
          {fill(texts.order, { number: item.orderNumber })}
        </h3>
        <span className="rounded-full border border-petroleo/40 px-3 text-sm font-semibold">
          {texts.stages[item.status]}
        </span>
      </div>
      <p className="text-sm text-petroleo/80">
        {fill(texts.requestedAt, { date: when(item.createdAt, locale) })}
      </p>
      <p>
        <span className="font-semibold">{texts.reasonLabel}: </span>
        {texts.reasons[item.reason]}
      </p>
      {item.comment && (
        <p>
          <span className="font-semibold">{texts.commentLabel}: </span>
          {item.comment}
        </p>
      )}
      <div>
        <p className="font-semibold">{texts.linesLabel}</p>
        <ul className="list-disc pl-6">
          {item.items.map((line) => (
            <li key={line.sku}>
              {fill(texts.line, { sku: line.sku, quantity: line.quantity })}
            </li>
          ))}
        </ul>
      </div>
      {item.refundMxnCents !== null && (
        <p>
          {fill(texts.refundLine, {
            amount: formatMoney(item.refundMxnCents, 'MXN', locale),
          })}{' '}
          {item.restock ? texts.restockYes : texts.restockNo}
        </p>
      )}
      {note && (
        <output
          className={`block ${note.kind === 'error' ? 'text-red-800' : ''}`}
        >
          {note.text}
        </output>
      )}
      {form === null && (actions.prepare || actions.confirm !== null) && (
        <button
          type="button"
          onClick={() => {
            setNote(null);
            setForm(actions.prepare ? 'prepare' : 'confirm');
          }}
          className={BUTTON}
        >
          {stepLabel}
        </button>
      )}
      {form === 'prepare' && (
        <form
          noValidate
          onSubmit={prepare}
          aria-label={fill(texts.prepareTitle, { number: item.orderNumber })}
          className="flex flex-col gap-3"
        >
          <h4 className="font-semibold">
            {fill(texts.prepareTitle, { number: item.orderNumber })}
          </h4>
          <TextField
            id={`${base}-amount`}
            label={texts.amount}
            {...texts.fields.amount}
            exampleLabel={texts.exampleLabel}
            input={{
              inputMode: 'decimal',
              autoComplete: 'off',
              value: amount,
              onChange: (event) => setAmount(event.target.value),
            }}
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={restock}
              onChange={(event) => setRestock(event.target.checked)}
            />
            {texts.restock}
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy} className={BUTTON}>
              {busy ? texts.working : texts.prepare}
            </button>
            <button
              type="button"
              onClick={() => setForm(null)}
              className={QUIET}
            >
              {texts.cancel}
            </button>
          </div>
        </form>
      )}
      {form === 'confirm' && (
        <form
          noValidate
          onSubmit={confirm}
          aria-label={fill(texts.confirmTitle, { number: item.orderNumber })}
          className="flex flex-col gap-3"
        >
          <h4 className="font-semibold">
            {fill(texts.confirmTitle, { number: item.orderNumber })}
          </h4>
          <p>
            {fill(texts.confirmSummary, {
              // A request being confirmed was prepared, so it always has its amount.
              amount: formatMoney(item.refundMxnCents as number, 'MXN', locale),
            })}
          </p>
          {item.status === 'REFUNDING' && <p>{texts.retryNote}</p>}
          <p className="text-sm text-petroleo/80">{texts.manualNote}</p>
          <TextField
            id={`${base}-reference`}
            label={texts.manualReference}
            {...texts.fields.manualReference}
            exampleLabel={texts.exampleLabel}
            input={{
              maxLength: 128,
              autoComplete: 'off',
              value: reference,
              onChange: (event) => setReference(event.target.value),
            }}
          />
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy} className={BUTTON}>
              {busy ? texts.working : texts.confirm}
            </button>
            <button
              type="button"
              onClick={() => setForm(null)}
              className={QUIET}
            >
              {texts.cancel}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

/**
 * The board of returns of `{area}devoluciones/` (FC 073 F1, K-80 second part): shown only to an
 * account with `returns:view`, and only as a convenience, since the API refuses everyone else.
 * It lists up to 200 requests, newest first, every stage or just one, and offers each its step to
 * whoever holds the permission: one person prepares the refund (the amount, and whether the
 * pieces go back to the inventory) and another confirms it. A refund made by hand at Mercado Pago
 * is confirmed with its reference.
 *
 * @param texts - `account.returns` texts.
 * @param locale - Language of the page, for the dates and the amounts.
 * @param canPrepare - The session holds `returns:prepare`.
 * @param canConfirm - The session holds `returns:confirm`.
 */
export function ReturnsConsole({
  texts,
  locale,
  canPrepare,
  canConfirm,
}: Readonly<{
  texts: ReturnsTexts;
  locale: Locale;
  canPrepare: boolean;
  canConfirm: boolean;
}>) {
  const filterId = useId();
  const [stage, setStage] = useState<ReturnView['status'] | ''>('');
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [items, setItems] = useState<ReturnView[]>([]);

  useEffect(() => {
    let current = true;
    setLoad({ kind: 'loading' });
    void listReturns(stage === '' ? undefined : stage).then((result) => {
      if (!current) return;
      if (result.ok) {
        setItems(result.data.items);
        setLoad({ kind: 'ready', total: result.data.total });
      } else {
        setLoad({ kind: 'failed', reason: result.reason });
      }
    });
    return () => {
      current = false;
    };
  }, [stage]);

  /** Shows a request as the API answered it after a step. */
  function replace(next: ReturnView) {
    setItems((now) => now.map((item) => (item.id === next.id ? next : item)));
  }

  return (
    <section aria-label={texts.title} className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{texts.title}</h2>
      <p className="text-petroleo/80">{texts.intro}</p>
      <div className="max-w-md">
        <Field
          id={filterId}
          label={texts.filterLabel}
          {...texts.fields.filter}
          exampleLabel={texts.exampleLabel}
        >
          {(control) => (
            <select
              {...control}
              value={stage}
              onChange={(event) =>
                setStage(event.target.value as ReturnView['status'] | '')
              }
              className="min-h-11 rounded-md border border-petroleo/30 bg-white px-3"
            >
              <option value="">{texts.filterAll}</option>
              {STAGES.map((name) => (
                <option key={name} value={name}>
                  {texts.stages[name]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {load.kind === 'loading' && (
        <output className="block">{texts.loading}</output>
      )}
      {load.kind === 'failed' && (
        <output className="block text-red-800">
          {failureText(texts, load.reason)}
        </output>
      )}
      {load.kind === 'ready' && items.length === 0 && <p>{texts.empty}</p>}
      {load.kind === 'ready' && items.length > 0 && (
        <>
          <p className="text-sm text-petroleo/80">
            {fill(texts.total, { n: load.total })}
          </p>
          <ul className="flex flex-col gap-4">
            {items.map((item) => (
              <ReturnCard
                key={item.id}
                item={item}
                texts={texts}
                locale={locale}
                grants={{ canPrepare, canConfirm }}
                onChanged={replace}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
