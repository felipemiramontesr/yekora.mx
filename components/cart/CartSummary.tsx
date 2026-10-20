import { useId } from 'react';
import type { Locale, Messages } from '@/app/i18n';
import type { QuoteState } from '@/lib/api/cartClient';
import { MEXICAN_STATES } from '@/lib/cart/mxStates';
import { fill, formatMoney, priceNote } from '@/lib/catalog/format';

/** Props of {@link CartSummary}. */
interface CartSummaryProps {
  /** Language of the page. */
  locale: Locale;
  /** Live quote of the cart. */
  state: QuoteState;
  /** Delivery state chosen by the buyer, or null. */
  stateCode: string | null;
  /** Changes (or clears, with null) the delivery state. */
  onStateChange: (code: string | null) => void;
  /** `cart` texts. */
  messages: Messages['cart'];
  /** `catalog.price` texts (currency and FIX notes). */
  priceMessages: Messages['catalog']['price'];
}

type Totals = NonNullable<QuoteState['quote']>['summary'];

function statusText(
  state: QuoteState,
  messages: Messages['cart']['summary']
): string | null {
  if (state.status === 'loading') return messages.updating;
  if (state.status !== 'error') return null;
  return state.error === 'offline' ? messages.offline : messages.failed;
}

/**
 * What the shipping row says. Only the server prices shipping (FC 011): this maps its answer,
 * in this order, to text: why it could not be priced, no state chosen yet, then the T1.1/T1.2
 * outcome (not covered, free, or the amount).
 */
function shippingText(
  totals: Totals,
  state: QuoteState,
  stateCode: string | null,
  locale: Locale,
  texts: Messages['cart']['shipping']
): string {
  if (state.shippingIssue === 'cart_unavailable') return texts.cartUnavailable;
  if (state.shippingIssue === 'invalid_destination') return texts.invalidState;
  if (stateCode === null || totals.shippingCode === null) return texts.pending;
  if (totals.shippingCode === 'UNSERVICEABLE_DESTINATION') {
    const chosen = MEXICAN_STATES.find((s) => s.code === stateCode);
    const name = locale === 'en' ? chosen?.en : chosen?.es;
    return fill(texts.unserviceable, { state: name ?? stateCode });
  }
  if (totals.shippingCode === 'FREE_SHIPPING') return texts.free;
  // STANDARD_RATE always carries its total (cartQuoteSchema); Number() keeps the type honest.
  return formatMoney(Number(totals.shippingTotalMxnCents), 'MXN', locale);
}

/**
 * Totals of the cart as the server quoted them (FC 009, LFPC 7 Bis; shipping FC 011): the
 * delivery state selector, the products with VAT, the shipping line, then subtotal before VAT,
 * the 16 % VAT and the total the buyer pays, plus the USD reference in English (Ω decision).
 * It shows only what the API confirmed; while a re-quote runs or after a failure it keeps the
 * last confirmed amounts and says so.
 */
export function CartSummary({
  locale,
  state,
  stateCode,
  onStateChange,
  messages,
  priceMessages,
}: Readonly<CartSummaryProps>) {
  const titleId = useId();
  const selectId = useId();
  const { summary, shipping } = messages;
  const totals = state.quote?.summary;
  const plural = new Intl.PluralRules(locale).select(totals?.totalItems ?? 0);
  const status = statusText(state, summary);
  const usd =
    locale === 'en' && totals?.referenceUsdCents != null
      ? formatMoney(totals.referenceUsdCents, 'USD', locale)
      : null;
  const remaining = totals?.freeShippingRemainingMxnCents ?? null;
  return (
    <section
      aria-labelledby={titleId}
      className="rounded-xl border border-petroleo/15 bg-white/60 p-5"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        {summary.title}
      </h2>
      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor={selectId} className="text-sm font-medium">
          {shipping.stateLabel}
        </label>
        <select
          id={selectId}
          value={stateCode ?? ''}
          onChange={(event) => onStateChange(event.target.value || null)}
          className="min-h-11 rounded-md border border-petroleo/30 bg-white px-3"
        >
          <option value="">{shipping.choose}</option>
          {MEXICAN_STATES.map((option) => (
            <option key={option.code} value={option.code}>
              {locale === 'en' ? option.en : option.es}
            </option>
          ))}
        </select>
      </div>
      {totals && (
        <>
          <p className="mt-3 text-sm text-petroleo/80">
            {fill(plural === 'one' ? summary.items.one : summary.items.other, {
              count: totals.totalItems,
            })}
          </p>
          <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
            <dt>{shipping.items}</dt>
            <dd className="text-right">
              {formatMoney(totals.itemsTotalMxnCents, 'MXN', locale)}
            </dd>
            <dt>{shipping.row}</dt>
            <dd data-shipping className="max-w-56 text-right">
              {shippingText(totals, state, stateCode, locale, shipping)}
            </dd>
            <dt className="border-t border-petroleo/15 pt-2">
              {summary.subtotal}
            </dt>
            <dd className="border-t border-petroleo/15 pt-2 text-right">
              {formatMoney(totals.subtotalMxnCents, 'MXN', locale)}
            </dd>
            <dt>{summary.tax}</dt>
            <dd className="text-right">
              {formatMoney(totals.taxMxnCents, 'MXN', locale)}
            </dd>
            <dt className="border-t border-petroleo/15 pt-2 text-base font-semibold">
              {summary.total}
            </dt>
            <dd className="border-t border-petroleo/15 pt-2 text-right text-base font-semibold">
              {formatMoney(totals.totalMxnCents, 'MXN', locale)}
            </dd>
          </dl>
          {remaining !== null && remaining > 0 && (
            <div className="mt-3 text-sm">
              <p id={`${titleId}-free`}>
                {fill(shipping.freeProgress, {
                  amount: formatMoney(remaining, 'MXN', locale),
                })}
              </p>
              <progress
                aria-labelledby={`${titleId}-free`}
                value={totals.itemsTotalMxnCents}
                max={totals.itemsTotalMxnCents + remaining}
                className="mt-1 h-2 w-full accent-ocre"
              />
            </div>
          )}
          {totals.shippingCode === 'FREE_SHIPPING' && (
            <p className="mt-3 text-sm font-medium">{shipping.freeGranted}</p>
          )}
          {usd && (
            <p className="mt-2 text-right text-sm text-petroleo/80">
              {fill(summary.usdReference, { usd })}
            </p>
          )}
          <p className="mt-3 text-xs text-petroleo/80">
            {priceNote(priceMessages, totals.exchangeRate, locale)}
          </p>
        </>
      )}
      <output
        aria-live="polite"
        className="mt-3 block text-sm text-petroleo/80"
      >
        {status}
      </output>
    </section>
  );
}
