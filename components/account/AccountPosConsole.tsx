'use client';

import {
  type SubmitEvent,
  useCallback,
  useEffect,
  useId,
  useState,
} from 'react';
import type { z } from 'zod';
import type { Locale, Messages } from '@/app/i18n';
import type { posProductsSchema, posShiftSchema } from '@/lib/account/posTypes';
import {
  closeTill,
  listCounterProducts,
  moveTillCash,
  openTill,
  type PosFailure,
  readReceipt,
  readShift,
  sell,
} from '@/lib/api/posClient';
import { fill, formatMoney } from '@/lib/catalog/format';
import { Field } from '../ui/Field';
import { TextField } from '../ui/TextField';

/** `account.pos` texts. */
export type PosTexts = Messages['account']['pos'];

type Shift = z.infer<typeof posShiftSchema>;
type Product = z.infer<typeof posProductsSchema>['items'][number];

/** What the screen says after an action. */
type Note = { kind: 'ok' | 'error'; text: string } | null;

/** One line of the sale being made. */
interface CartLine {
  product: Product;
  quantity: number;
}

const PESOS = /^\d+(\.\d{1,2})?$/;
const BUTTON =
  'tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60';
const QUIET =
  'tap-target self-start rounded-lg border border-petroleo/40 px-5 font-semibold';
const CONTROL =
  'min-h-11 rounded-md border border-petroleo/30 bg-white px-3 aria-invalid:border-red-700';
const PANEL = 'flex flex-col gap-3 rounded-xl border border-petroleo/20 p-5';

/** Cents of an amount typed in pesos, or null when it is not one. */
function centsOf(text: string): number | null {
  const typed = text.trim();
  return PESOS.test(typed) ? Math.round(Number(typed) * 100) : null;
}

/** The message of a refusal: the screen names each code; anything else is generic. */
function failureText(texts: PosTexts, reason: PosFailure) {
  return reason in texts.errors
    ? texts.errors[reason as keyof PosTexts['errors']]
    : texts.errors.unknown;
}

/** A note as the page shows it. */
function NoteLine({ note }: Readonly<{ note: Note }>) {
  return note ? (
    <output className={`block ${note.kind === 'error' ? 'text-red-800' : ''}`}>
      {note.text}
    </output>
  ) : null;
}

/** An amount field in pesos. */
function MoneyField({
  id,
  label,
  hint,
  exampleLabel,
  value,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  hint: { description: string; example: string };
  exampleLabel: string;
  value: string;
  onChange: (next: string) => void;
}>) {
  return (
    <TextField
      id={id}
      label={label}
      {...hint}
      exampleLabel={exampleLabel}
      input={{
        inputMode: 'decimal',
        autoComplete: 'off',
        value,
        onChange: (event) => onChange(event.target.value),
      }}
    />
  );
}

/** The till closed: the opening cash starts the shift. */
function OpenTill({
  texts,
  onOpened,
}: Readonly<{ texts: PosTexts; onOpened: (shift: Shift) => void }>) {
  const base = useId();
  const [cash, setCash] = useState('');
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const cents = centsOf(cash);
    if (cents === null) {
      setNote({ kind: 'error', text: texts.invalidAmount });
      return;
    }
    setBusy(true);
    const result = await openTill(cents);
    setBusy(false);
    if (result.ok) onOpened(result.data);
    else setNote({ kind: 'error', text: failureText(texts, result.reason) });
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-label={texts.openTitle}
      className={PANEL}
    >
      <h3 className="text-lg font-semibold">{texts.openTitle}</h3>
      <MoneyField
        id={`${base}-opening`}
        label={texts.openingCash}
        hint={texts.fields.openingCash}
        exampleLabel={texts.exampleLabel}
        value={cash}
        onChange={setCash}
      />
      <NoteLine note={note} />
      <button type="submit" disabled={busy} className={BUTTON}>
        {texts.open}
      </button>
    </form>
  );
}

/** Cash put in or taken out of the drawer. */
function Movements({
  texts,
  shift,
}: Readonly<{ texts: PosTexts; shift: Shift }>) {
  const base = useId();
  const [type, setType] = useState<'IN' | 'OUT'>('OUT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const cents = centsOf(amount);
    if (cents === null || cents === 0 || reason.trim() === '') {
      setNote({ kind: 'error', text: texts.invalidMovement });
      return;
    }
    setBusy(true);
    const result = await moveTillCash({
      shiftId: shift.id,
      type,
      amountMxnCents: cents,
      reason: reason.trim(),
    });
    setBusy(false);
    if (!result.ok) {
      setNote({ kind: 'error', text: failureText(texts, result.reason) });
      return;
    }
    setAmount('');
    setReason('');
    setNote({ kind: 'ok', text: texts.moved });
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-label={texts.movementsTitle}
      className={PANEL}
    >
      <h3 className="text-lg font-semibold">{texts.movementsTitle}</h3>
      <Field
        id={`${base}-type`}
        label={texts.movementType}
        {...texts.fields.movementType}
        exampleLabel={texts.exampleLabel}
      >
        {(control) => (
          <select
            {...control}
            className={CONTROL}
            value={type}
            onChange={(event) => setType(event.target.value as 'IN' | 'OUT')}
          >
            <option value="OUT">{texts.movementOut}</option>
            <option value="IN">{texts.movementIn}</option>
          </select>
        )}
      </Field>
      <MoneyField
        id={`${base}-amount`}
        label={texts.movementAmount}
        hint={texts.fields.movementAmount}
        exampleLabel={texts.exampleLabel}
        value={amount}
        onChange={setAmount}
      />
      <TextField
        id={`${base}-reason`}
        label={texts.movementReason}
        {...texts.fields.movementReason}
        exampleLabel={texts.exampleLabel}
        input={{
          maxLength: 255,
          autoComplete: 'off',
          value: reason,
          onChange: (event) => setReason(event.target.value),
        }}
      />
      <NoteLine note={note} />
      <button type="submit" disabled={busy} className={QUIET}>
        {texts.recordMovement}
      </button>
    </form>
  );
}

/** The blind count that closes the shift. */
function CloseTill({
  texts,
  locale,
  shift,
  onClosed,
}: Readonly<{
  texts: PosTexts;
  locale: Locale;
  shift: Shift;
  onClosed: (message: string) => void;
}>) {
  const base = useId();
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const cents = centsOf(counted);
    if (cents === null) {
      setNote({ kind: 'error', text: texts.invalidAmount });
      return;
    }
    const remark = notes.trim();
    setBusy(true);
    const result = await closeTill(shift.id, {
      countedCashMxnCents: cents,
      ...(remark === '' ? {} : { notes: remark }),
    });
    setBusy(false);
    if (!result.ok) {
      setNote({ kind: 'error', text: failureText(texts, result.reason) });
      return;
    }
    onClosed(
      fill(texts.closed, {
        expected: formatMoney(result.data.expectedCashMxnCents, 'MXN', locale),
        difference: formatMoney(result.data.differenceMxnCents, 'MXN', locale),
      })
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-label={texts.closeTitle}
      className={PANEL}
    >
      <h3 className="text-lg font-semibold">{texts.closeTitle}</h3>
      <p className="text-sm text-petroleo/80">{texts.closeIntro}</p>
      <MoneyField
        id={`${base}-counted`}
        label={texts.counted}
        hint={texts.fields.counted}
        exampleLabel={texts.exampleLabel}
        value={counted}
        onChange={setCounted}
      />
      <TextField
        id={`${base}-notes`}
        label={texts.notes}
        {...texts.fields.notes}
        exampleLabel={texts.exampleLabel}
        input={{
          maxLength: 255,
          autoComplete: 'off',
          value: notes,
          onChange: (event) => setNotes(event.target.value),
        }}
      />
      <NoteLine note={note} />
      <button type="submit" disabled={busy} className={QUIET}>
        {texts.close}
      </button>
    </form>
  );
}

/** The payment fields typed at the counter. */
interface PaymentDraft {
  method: 'POS_CASH' | 'POS_CARD_MANUAL';
  tendered: string;
  authCode: string;
  lastFour: string;
  brand: string;
  folio: string;
  email: string;
}

const EMPTY_PAYMENT: PaymentDraft = {
  method: 'POS_CASH',
  tendered: '',
  authCode: '',
  lastFour: '',
  brand: '',
  folio: '',
  email: '',
};

/** The payment as the API takes it. */
function paymentOf(draft: PaymentDraft, total: number) {
  if (draft.method === 'POS_CASH') {
    return {
      method: draft.method,
      tenderedMxnCents: centsOf(draft.tendered) ?? 0,
    };
  }
  return {
    method: draft.method,
    confirmedAmountMxnCents: total,
    terminalAuthCode: draft.authCode.trim(),
    cardLastFour: draft.lastFour.trim(),
    cardBrand: draft.brand.trim(),
    voucherFolio: draft.folio.trim(),
  };
}

/** The receipt of the last sale, ready to print. */
function Receipt({
  texts,
  orderNumber,
}: Readonly<{ texts: PosTexts; orderNumber: string }>) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [note, setNote] = useState<Note>(null);

  async function show() {
    const result = await readReceipt(orderNumber, 80);
    if (!result.ok) {
      setNote({ kind: 'error', text: failureText(texts, result.reason) });
      return;
    }
    setNote(null);
    setLines(result.data.lines);
  }

  return (
    <div className="flex flex-col gap-3">
      <NoteLine note={note} />
      {lines === null ? (
        <button type="button" onClick={() => void show()} className={QUIET}>
          {texts.showReceipt}
        </button>
      ) : (
        <>
          <pre className="overflow-x-auto bg-white p-3 text-xs">
            {lines.join('\n')}
          </pre>
          <button
            type="button"
            onClick={() => globalThis.print()}
            className={QUIET}
          >
            {texts.print}
          </button>
        </>
      )}
    </div>
  );
}

/** The sale: search a product, add it, take the payment. */
function Sale({
  texts,
  locale,
}: Readonly<{ texts: PosTexts; locale: Locale }>) {
  const base = useId();
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [draft, setDraft] = useState<PaymentDraft>(EMPTY_PAYMENT);
  const [note, setNote] = useState<Note>(null);
  const [sold, setSold] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = cart.reduce(
    (sum, line) => sum + line.product.priceMxnCents * line.quantity,
    0
  );
  const money = (cents: number) => formatMoney(cents, 'MXN', locale);
  const nameOf = (product: Product) =>
    locale === 'en' ? product.nameEn : product.nameEs;
  const set = (key: keyof PaymentDraft, value: string) =>
    setDraft((now) => ({ ...now, [key]: value }));

  async function find(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await listCounterProducts(search);
    if (!result.ok) {
      setNote({ kind: 'error', text: failureText(texts, result.reason) });
      return;
    }
    setNote(null);
    setProducts(result.data.items);
  }

  function add(product: Product) {
    setSold(null);
    setCart((lines) => {
      const found = lines.find((line) => line.product.sku === product.sku);
      if (!found) return [...lines, { product, quantity: 1 }];
      return lines.map((line) =>
        line === found ? { ...line, quantity: line.quantity + 1 } : line
      );
    });
  }

  async function charge(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = draft.email.trim();
    setBusy(true);
    const result = await sell({
      items: cart.map((line) => ({
        sku: line.product.sku,
        quantity: line.quantity,
      })),
      payment: paymentOf(draft, total),
      ...(email === '' ? {} : { customerEmail: email }),
    });
    setBusy(false);
    if (!result.ok) {
      setNote({ kind: 'error', text: failureText(texts, result.reason) });
      return;
    }
    setCart([]);
    setProducts([]);
    setDraft(EMPTY_PAYMENT);
    setSold(result.data.orderNumber);
    setNote({
      kind: 'ok',
      text: fill(texts.sold, {
        number: result.data.orderNumber,
        total: money(result.data.totalMxnCents),
        change: money(result.data.changeMxnCents),
      }),
    });
  }

  const text = (key: 'authCode' | 'lastFour' | 'brand' | 'folio' | 'email') => (
    <TextField
      id={`${base}-${key}`}
      label={texts[key]}
      {...texts.fields[key]}
      exampleLabel={texts.exampleLabel}
      input={{
        autoComplete: 'off',
        value: draft[key],
        onChange: (event) => set(key, event.target.value),
      }}
    />
  );

  return (
    <div className={PANEL}>
      <h3 className="text-lg font-semibold">{texts.saleTitle}</h3>
      <form
        onSubmit={(event) => void find(event)}
        aria-label={texts.searchTitle}
        className="flex flex-col gap-3"
      >
        <TextField
          id={`${base}-search`}
          label={texts.search}
          {...texts.fields.search}
          exampleLabel={texts.exampleLabel}
          input={{
            value: search,
            onChange: (event) => setSearch(event.target.value),
          }}
        />
        <button type="submit" className={QUIET}>
          {texts.searchButton}
        </button>
      </form>
      <ul className="flex flex-col gap-2">
        {products.map((product) => (
          <li
            key={product.sku}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <span>
              {nameOf(product)} · {product.sku} · {money(product.priceMxnCents)}{' '}
              · {fill(texts.available, { n: product.available })}
            </span>
            <button
              type="button"
              disabled={product.available < 1}
              onClick={() => add(product)}
              className={QUIET}
              aria-label={`${texts.add}: ${product.sku}`}
            >
              {texts.add}
            </button>
          </li>
        ))}
      </ul>
      <NoteLine note={note} />
      {sold && <Receipt key={sold} texts={texts} orderNumber={sold} />}
      {cart.length > 0 && (
        <form
          noValidate
          onSubmit={(event) => void charge(event)}
          aria-label={texts.chargeTitle}
          className="flex flex-col gap-3"
        >
          <ul>
            {cart.map((line) => (
              <li key={line.product.sku} className="flex justify-between gap-2">
                <span>
                  {line.quantity} × {nameOf(line.product)}
                </span>
                <span>
                  {money(line.product.priceMxnCents * line.quantity)}{' '}
                  <button
                    type="button"
                    className="underline"
                    aria-label={`${texts.remove}: ${line.product.sku}`}
                    onClick={() =>
                      setCart((lines) => lines.filter((l) => l !== line))
                    }
                  >
                    {texts.remove}
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xl font-semibold">
            {texts.total}: {money(total)}
          </p>
          <Field
            id={`${base}-method`}
            label={texts.method}
            {...texts.fields.method}
            exampleLabel={texts.exampleLabel}
          >
            {(control) => (
              <select
                {...control}
                className={CONTROL}
                value={draft.method}
                onChange={(event) => set('method', event.target.value)}
              >
                <option value="POS_CASH">{texts.cash}</option>
                <option value="POS_CARD_MANUAL">{texts.card}</option>
              </select>
            )}
          </Field>
          {draft.method === 'POS_CASH' ? (
            <>
              <MoneyField
                id={`${base}-tendered`}
                label={texts.tendered}
                hint={texts.fields.tendered}
                exampleLabel={texts.exampleLabel}
                value={draft.tendered}
                onChange={(value) => set('tendered', value)}
              />
              <p>
                {texts.change}:{' '}
                {money(Math.max(0, (centsOf(draft.tendered) ?? 0) - total))}
              </p>
            </>
          ) : (
            <>
              <p>{fill(texts.chargeOnTerminal, { total: money(total) })}</p>
              {text('authCode')}
              {text('lastFour')}
              {text('brand')}
              {text('folio')}
            </>
          )}
          {text('email')}
          <button type="submit" disabled={busy} className={BUTTON}>
            {busy ? texts.charging : texts.charge}
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * The point of sale of `{area}pos/` (FC 076 F4, K-79): shown only to an account with `pos:sell` or
 * `pos:shift`, and only as a convenience, since the API refuses everyone else. With the till
 * closed it opens a shift; with it open it sells from the shared stock (cash with its change, or
 * the Banorte terminal with the voucher data), prints the receipt, moves cash in and out and
 * closes with a blind count.
 *
 * @param texts - `account.pos` texts.
 * @param locale - Language of the page, for names and amounts.
 */
export function AccountPosConsole({
  texts,
  locale,
}: Readonly<{ texts: PosTexts; locale: Locale }>) {
  const [shift, setShift] = useState<Shift | null | undefined>(undefined);
  const [note, setNote] = useState<Note>(null);

  const load = useCallback(async () => {
    const result = await readShift();
    if (result.ok) setShift(result.data.shift);
    else setNote({ kind: 'error', text: failureText(texts, result.reason) });
  }, [texts]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-label={texts.title} className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{texts.title}</h2>
      <NoteLine note={note} />
      {shift === undefined && !note && (
        <output className="block">{texts.loading}</output>
      )}
      {shift === null && (
        <OpenTill
          texts={texts}
          onOpened={(opened) => {
            setNote(null);
            setShift(opened);
          }}
        />
      )}
      {shift && (
        <>
          <p>
            {fill(texts.shiftOpen, {
              amount: formatMoney(shift.openingCashMxnCents, 'MXN', locale),
            })}
          </p>
          <Sale texts={texts} locale={locale} />
          <Movements texts={texts} shift={shift} />
          <CloseTill
            texts={texts}
            locale={locale}
            shift={shift}
            onClosed={(message) => {
              setNote({ kind: 'ok', text: message });
              setShift(null);
            }}
          />
        </>
      )}
    </section>
  );
}
