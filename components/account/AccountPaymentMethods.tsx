'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import type { Locale, Messages } from '@/app/i18n';
import type { SavedCard } from '@/lib/account/paymentMethodTypes';
import {
  detachPaymentMethod,
  listPaymentMethods,
  type PaymentMethodsFailure,
  settlePaymentMethods,
  startPaymentMethodSetup,
} from '@/lib/api/paymentMethodsClient';
import { fill } from '@/lib/catalog/format';
import { isGatewayUrl } from '@/lib/checkout/gateway';

/** `account.paymentMethods` texts. */
type CardTexts = Messages['account']['paymentMethods'];

/** What Stripe's page puts in the address when it sends the person back after adding a card. */
const CARD_ADDED = /[?&]setup=done(?:&|$)/;

/** What the page says after an action: a confirmation or the refusal. */
type Note = { kind: 'ok' | 'error'; text: string } | null;

/** The message of a refusal: the page names every reason the client can give. */
function failureText(texts: CardTexts, reason: PaymentMethodsFailure): string {
  return texts.errors[reason];
}

/** The brand as the page names it; one Stripe does not list here is just «Tarjeta». */
function brandName(texts: CardTexts, brand: string): string {
  const names: Record<string, string> = texts.brands;
  return names[brand] ?? texts.brands.other;
}

/**
 * «Métodos de pago» of the account area (FC 054 T2.4, T2.6; FC 057): the one card the account keeps
 * at Stripe, with its brand, last four digits and expiry, a «Reemplazar tarjeta» (or «Agregar
 * tarjeta» when there is none) that opens Stripe's own page, a confirmed «Eliminar tarjeta», what
 * Stripe Link and the wallets are (independent of this store), and a card that says Mercado Pago
 * manages its own methods. When Stripe sends the person back with a new card, or the page finds
 * more than one, the account is settled to the newest. The card itself never touches this page or
 * the API: it is typed on Stripe's hosted page (PCI DSS SAQ A), and what is shown here is read from
 * Stripe each time and forgotten.
 *
 * @param messages - `account` texts.
 * @param locale - Language of the page, where Stripe sends the person back to.
 */
export function AccountPaymentMethods({
  messages,
  locale,
}: Readonly<{ messages: Messages['account']; locale: Locale }>) {
  const texts = messages.paymentMethods;
  const mercadoPagoId = useId();
  const walletsId = useId();
  const [cards, setCards] = useState<SavedCard[] | null>(null);
  const [note, setNote] = useState<Note>(null);
  // Stripe's id of the card whose removal is being confirmed, or none.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Stripe's page is being opened: the button says so and stays off, also once the page is leaving.
  const [opening, setOpening] = useState(false);

  // With a card the button replaces it; without one it adds the first.
  const actionName =
    cards !== null && cards.length > 0 ? texts.replace : texts.add;

  /** Reads the card from Stripe through the API; more than one is settled to the newest first. */
  const load = useCallback(async () => {
    let result = await listPaymentMethods();
    if (result.ok && result.data.items.length > 1) {
      const settled = await settlePaymentMethods();
      setNote(
        settled.ok
          ? { kind: 'ok', text: texts.replaced }
          : { kind: 'error', text: failureText(texts, settled.reason) }
      );
      result = await listPaymentMethods();
    }
    if (result.ok) {
      setCards(result.data.items.slice(0, 1));
      return;
    }
    setCards([]);
    setNote({ kind: 'error', text: failureText(texts, result.reason) });
  }, [texts]);

  useEffect(() => {
    // Stripe's page sends the person back with the mark of a card just added: it leaves the
    // address at once, so a reload does not settle twice, and the account is left with that card.
    const returned = CARD_ADDED.test(globalThis.location.search);
    void (async () => {
      if (returned) {
        globalThis.history.replaceState(null, '', globalThis.location.pathname);
        const settled = await settlePaymentMethods();
        setNote(
          settled.ok
            ? {
                kind: 'ok',
                text:
                  settled.data.status === 'replaced'
                    ? texts.replaced
                    : texts.saved,
              }
            : { kind: 'error', text: failureText(texts, settled.reason) }
        );
      }
      await load();
    })();
  }, [load, texts]);

  async function add() {
    setOpening(true);
    setNote(null);
    const result = await startPaymentMethodSetup(locale);
    // Only Stripe's own page is ever opened, whatever the answer says (no open redirect).
    if (result.ok && isGatewayUrl(result.data.redirectUrl)) {
      globalThis.location.assign(result.data.redirectUrl);
      return;
    }
    setOpening(false);
    setNote({
      kind: 'error',
      text: failureText(texts, result.ok ? 'invalid' : result.reason),
    });
  }

  async function remove(card: SavedCard) {
    setBusy(true);
    const result = await detachPaymentMethod(card.id);
    setBusy(false);
    setConfirming(null);
    if (!result.ok) {
      setNote({ kind: 'error', text: failureText(texts, result.reason) });
      // A card that is already gone is not worth showing any longer.
      if (result.reason === 'PAYMENT_METHOD_NOT_FOUND') await load();
      return;
    }
    setNote({ kind: 'ok', text: texts.removed });
    await load();
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {/* Always in the page, so a screen reader hears what an action did. */}
      <output
        aria-live="polite"
        className={`block ${note?.kind === 'error' ? 'text-red-800' : ''}`}
      >
        {note?.text}
      </output>
      <section aria-label={texts.title} className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{texts.title}</h2>
        <p className="text-petroleo/80">{texts.intro}</p>
        {cards === null ? (
          <output className="block">{texts.loading}</output>
        ) : (
          <>
            {cards.length === 0 && <p>{texts.empty}</p>}
            <ul className="flex flex-col gap-4">
              {cards.map((card) => (
                <CardRow
                  key={card.id}
                  card={card}
                  texts={texts}
                  busy={busy}
                  confirming={confirming === card.id}
                  onAskRemove={() => setConfirming(card.id)}
                  onRemove={() => void remove(card)}
                  onKeep={() => setConfirming(null)}
                />
              ))}
            </ul>
            <button
              type="button"
              disabled={busy || opening}
              onClick={() => void add()}
              className="tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60"
            >
              {opening ? texts.adding : actionName}
            </button>
            <p className="text-sm text-petroleo/80">{texts.addHint}</p>
          </>
        )}
      </section>
      <section
        aria-labelledby={walletsId}
        className="flex flex-col gap-2 rounded-lg border border-petroleo/20 p-4"
      >
        <h2 id={walletsId} className="text-lg font-semibold">
          {texts.wallets.title}
        </h2>
        <p>{texts.wallets.text}</p>
      </section>
      <section
        aria-labelledby={mercadoPagoId}
        className="flex flex-col gap-2 rounded-lg border border-petroleo/20 p-4"
      >
        <h2 id={mercadoPagoId} className="text-lg font-semibold">
          {texts.mercadoPago.title}
        </h2>
        <p>{texts.mercadoPago.text}</p>
      </section>
    </div>
  );
}

/** One saved card, with its confirmed removal. */
function CardRow({
  card,
  texts,
  busy,
  confirming,
  onAskRemove,
  onRemove,
  onKeep,
}: Readonly<{
  card: SavedCard;
  texts: CardTexts;
  busy: boolean;
  confirming: boolean;
  onAskRemove: () => void;
  onRemove: () => void;
  onKeep: () => void;
}>) {
  const name = fill(texts.cardName, {
    brand: brandName(texts, card.brand),
    last4: card.last4,
  });
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-petroleo/20 p-4">
      <h3 className="text-lg font-semibold">{name}</h3>
      <p>
        {fill(texts.expires, {
          month: String(card.expMonth).padStart(2, '0'),
          year: String(card.expYear),
        })}
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={onAskRemove}
          aria-label={`${texts.remove}: ${name}`}
          className="tap-target underline"
        >
          {texts.remove}
        </button>
      </div>
      {confirming && (
        <dialog
          open
          aria-labelledby={`confirm-${card.id}`}
          className="static m-0 flex w-full flex-col gap-2 rounded-lg border border-red-800/40 bg-white p-4 text-petroleo"
        >
          <p id={`confirm-${card.id}`} className="font-semibold">
            {texts.confirm.title}
          </p>
          <p>{texts.confirm.text}</p>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={onRemove}
              className="tap-target rounded-lg bg-red-800 px-5 font-semibold text-white"
            >
              {texts.confirm.yes}
            </button>
            <button
              type="button"
              onClick={onKeep}
              className="tap-target underline"
            >
              {texts.confirm.no}
            </button>
          </div>
        </dialog>
      )}
    </li>
  );
}
