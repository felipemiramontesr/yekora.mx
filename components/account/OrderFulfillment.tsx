'use client';

import { type SubmitEvent, useId, useState } from 'react';
import type { Messages } from '@/app/i18n';
import type { OrderDetail } from '@/lib/account/orderTypes';
import {
  deliverOrder,
  type FulfillmentFailure,
  prepareOrder,
  shipOrder,
} from '@/lib/api/fulfillmentClient';
import { fill } from '@/lib/catalog/format';
import { TextField } from '../ui/TextField';

/** `account.fulfillment` texts. */
type FulfillmentTexts = Messages['account']['fulfillment'];

/** What the panel says after an action. */
type Note = { kind: 'ok' | 'error'; text: string } | null;

/** The message of a refusal: the panel names each code; anything else is generic. */
function failureText(texts: FulfillmentTexts, reason: FulfillmentFailure) {
  return reason in texts.errors
    ? texts.errors[reason as keyof FulfillmentTexts['errors']]
    : texts.errors.unknown;
}

/** The button of a step. */
const BUTTON =
  'tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60';

/**
 * The fulfillment of one order in the panel (FC 068 F1, K-48): shown only to an account with
 * `orders:manage`, and only as a convenience, since the API refuses everyone else and every
 * order in a status the step does not admit. A paid order can be prepared or shipped, one being
 * prepared can be shipped (with its carrier, its tracking number and, if there is one, the link
 * to follow it), and a shipped one can be marked as delivered. Each step tells the buyer by
 * e-mail, except the delivery.
 *
 * @param order - The order as loaded, for its status.
 * @param texts - `account.fulfillment` texts.
 * @param statuses - `account.statuses`, to name the status the order reaches.
 * @param exampleLabel - The word that introduces the example of a field.
 * @param onDone - Called after a step was applied, so the order is read again.
 */
export function OrderFulfillment({
  order,
  texts,
  statuses,
  exampleLabel,
  onDone,
}: Readonly<{
  order: OrderDetail;
  texts: FulfillmentTexts;
  statuses: Messages['account']['statuses'];
  exampleLabel: string;
  onDone: () => void;
}>) {
  const base = useId();
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  // A paid order keeps `status` PAID while it is being fulfilled: its step is `fulfillment`.
  const step = order.fulfillment ?? null;
  const paid = order.status === 'PAID';
  const canPrepare = paid && step === null;
  const canShip = paid && (step === null || step === 'PREPARING');
  const canDeliver = paid && step === 'SHIPPED';

  /** Runs one step, says how it went and, when it applied, asks for the order again. */
  async function run(
    step: () => ReturnType<typeof prepareOrder>
  ): Promise<void> {
    setBusy(true);
    const result = await step();
    setBusy(false);
    if (!result.ok) {
      setNote({ kind: 'error', text: failureText(texts, result.reason) });
      return;
    }
    setNote({
      kind: 'ok',
      text: fill(texts.done, {
        status: statuses[result.data.fulfillment],
      }),
    });
    onDone();
  }

  function ship(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const link = trackingUrl.trim();
    void run(() =>
      shipOrder(order.orderNumber, {
        carrier,
        trackingNumber,
        ...(link === '' ? {} : { trackingUrl: link }),
      })
    );
  }

  return (
    <section
      aria-label={texts.title}
      className="mt-4 flex max-w-xl flex-col gap-4 border-t border-petroleo/15 pt-4"
    >
      <h3 className="text-lg font-semibold">{texts.title}</h3>
      <p className="text-sm text-petroleo/80">{texts.intro}</p>
      {note && (
        <output
          className={`block ${note.kind === 'error' ? 'text-red-800' : ''}`}
        >
          {note.text}
        </output>
      )}
      {!canShip && !canDeliver && <p>{texts.noActions}</p>}
      {canPrepare && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => prepareOrder(order.orderNumber))}
          className={BUTTON}
        >
          {busy ? texts.working : texts.prepare}
        </button>
      )}
      {canShip && (
        <form
          noValidate
          onSubmit={ship}
          aria-label={texts.shipTitle}
          className="flex flex-col gap-3"
        >
          <h4 className="font-semibold">{texts.shipTitle}</h4>
          <TextField
            id={`${base}-carrier`}
            label={texts.carrier}
            {...texts.fields.carrier}
            exampleLabel={exampleLabel}
            input={{
              maxLength: 64,
              autoComplete: 'off',
              value: carrier,
              onChange: (event) => setCarrier(event.target.value),
            }}
          />
          <TextField
            id={`${base}-tracking`}
            label={texts.trackingNumber}
            {...texts.fields.trackingNumber}
            exampleLabel={exampleLabel}
            input={{
              maxLength: 128,
              autoComplete: 'off',
              value: trackingNumber,
              onChange: (event) => setTrackingNumber(event.target.value),
            }}
          />
          <TextField
            id={`${base}-link`}
            label={texts.trackingUrl}
            {...texts.fields.trackingUrl}
            exampleLabel={exampleLabel}
            input={{
              type: 'url',
              maxLength: 512,
              autoComplete: 'off',
              value: trackingUrl,
              onChange: (event) => setTrackingUrl(event.target.value),
            }}
          />
          <button type="submit" disabled={busy} className={BUTTON}>
            {busy ? texts.working : texts.ship}
          </button>
        </form>
      )}
      {canDeliver && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => deliverOrder(order.orderNumber))}
          className={BUTTON}
        >
          {busy ? texts.working : texts.deliver}
        </button>
      )}
    </section>
  );
}
