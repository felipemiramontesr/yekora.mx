'use client';

import { type SubmitEvent, useEffect, useId, useState } from 'react';
import { fiscalDataVerdict } from '@/lib/account/fiscalTypes';
import type { OrderDetail } from '@/lib/account/orderTypes';
import { customerSchema } from '@/lib/checkout/checkoutTypes';
import {
  askForInvoice,
  readFiscalProfile,
  readInvoiceState,
} from '@/lib/api/invoiceClient';
import { fill } from '@/lib/catalog/format';
import { TextField } from '../ui/TextField';
import {
  BUTTON,
  EMPTY_FISCAL,
  FiscalFields,
  type FiscalForm,
  type FiscalTexts,
  invoiceFailureText,
  InvoiceFiles,
  normalized,
  type Note,
  NoteLine,
} from './invoiceShared';

/** Where the latest request of the order stands; null status when there is none. */
interface State {
  status: 'PENDING' | 'COMPLETED' | 'REJECTED' | 'CANCELLED' | null;
  reason: string | null;
}

/** What the page says of the request there is. */
function StateLine({
  state,
  orderNumber,
  texts,
}: Readonly<{ state: State; orderNumber: string; texts: FiscalTexts }>) {
  if (state.status === null) return null;
  return (
    <>
      <p>{texts.states[state.status]}</p>
      {state.reason !== null && (
        <p>{fill(texts.reasonLine, { reason: state.reason })}</p>
      )}
      {state.status === 'COMPLETED' && (
        <InvoiceFiles orderNumber={orderNumber} reader="buyer" texts={texts} />
      )}
    </>
  );
}

/**
 * «Factura» on the buyer's order page (FC 077 F4): where the request stands, the downloads once
 * there is an invoice, and the form to ask for one while the order is paid and none is waiting or
 * done. The API judges the window and what is left to invoice, and its refusal is the one that
 * counts.
 *
 * @param order - The order as the buyer reads it.
 * @param texts - `account.fiscal` texts.
 * @param exampleLabel - The word that introduces an example.
 * @param email - The account's e-mail, offered as the one to send the invoice to.
 */
export function OrderInvoiceRequest({
  order,
  texts,
  exampleLabel,
  email,
}: Readonly<{
  order: Pick<OrderDetail, 'orderNumber' | 'status'>;
  texts: FiscalTexts;
  exampleLabel: string;
  email: string;
}>) {
  const base = useId();
  const { orderNumber } = order;
  const [state, setState] = useState<State | null>(null);
  const [form, setForm] = useState<FiscalForm>(EMPTY_FISCAL);
  const [sendTo, setSendTo] = useState(email);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  useEffect(() => {
    let live = true;
    void readInvoiceState(orderNumber).then((result) => {
      if (live && result.ok) setState(result.data);
    });
    return () => {
      live = false;
    };
  }, [orderNumber]);

  const mayAsk =
    order.status === 'PAID' &&
    state !== null &&
    state.status !== 'PENDING' &&
    state.status !== 'COMPLETED';

  async function start() {
    setNote(null);
    setOpen(true);
    const saved = await readFiscalProfile();
    if (saved.ok) {
      const { defaultCfdiUse, ...data } = saved.data;
      setForm({ ...data, cfdiUse: defaultCfdiUse });
    }
  }

  async function send(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = normalized(form);
    const verdict = fiscalDataVerdict(values);
    if (verdict !== 'FISCAL_DATA_ACCEPTED') {
      setNote({ kind: 'error', text: texts.errors[verdict] });
      return;
    }
    const emailForInvoice = sendTo.trim();
    if (!customerSchema.shape.email.safeParse(emailForInvoice).success) {
      setNote({ kind: 'error', text: texts.invalidEmail });
      return;
    }
    setBusy(true);
    const result = await askForInvoice(orderNumber, {
      ...values,
      emailForInvoice,
    });
    setBusy(false);
    if (!result.ok) {
      setNote({
        kind: 'error',
        text: invoiceFailureText(texts, result.reason),
      });
      return;
    }
    setOpen(false);
    setState({ status: 'PENDING', reason: null });
    setNote({ kind: 'ok', text: texts.requested });
  }

  if (state === null || (state.status === null && !mayAsk)) return null;
  return (
    <section
      aria-label={texts.orderTitle}
      className="mt-4 flex max-w-xl flex-col gap-4 border-t border-petroleo/15 pt-4"
    >
      <h3 className="text-lg font-semibold">{texts.orderTitle}</h3>
      <StateLine state={state} orderNumber={orderNumber} texts={texts} />
      <NoteLine note={note} />
      {mayAsk && !open && (
        <button type="button" onClick={() => void start()} className={BUTTON}>
          {texts.ask}
        </button>
      )}
      {mayAsk && open && (
        <form
          noValidate
          onSubmit={(event) => void send(event)}
          aria-label={texts.ask}
          className="flex flex-col gap-4"
        >
          <p>{texts.askIntro}</p>
          <FiscalFields
            idBase={base}
            texts={texts}
            exampleLabel={exampleLabel}
            form={form}
            onChange={setForm}
          />
          <TextField
            id={`${base}-email`}
            {...texts.fields.email}
            exampleLabel={exampleLabel}
            input={{
              type: 'email',
              autoComplete: 'email',
              value: sendTo,
              onChange: (event) => setSendTo(event.target.value),
            }}
          />
          <button type="submit" disabled={busy} className={BUTTON}>
            {texts.send}
          </button>
        </form>
      )}
    </section>
  );
}
