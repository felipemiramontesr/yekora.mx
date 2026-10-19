import { useId } from 'react';
import type { Locale, Messages } from '@/app/i18n';
import type { QuoteState } from '@/lib/api/cartClient';
import { fill, formatMoney, priceNote } from '@/lib/catalog/format';

/** Props of {@link CartSummary}. */
interface CartSummaryProps {
  /** Language of the page. */
  locale: Locale;
  /** Live quote of the cart. */
  state: QuoteState;
  /** `cart` texts. */
  messages: Messages['cart'];
  /** `catalog.price` texts (currency and FIX notes). */
  priceMessages: Messages['catalog']['price'];
}

function statusText(
  state: QuoteState,
  messages: Messages['cart']['summary']
): string | null {
  if (state.status === 'loading') return messages.updating;
  if (state.status !== 'error') return null;
  return state.error === 'offline' ? messages.offline : messages.failed;
}

/**
 * Totals of the cart as the server quoted them (FC 009, LFPC 7 Bis): subtotal before VAT, the
 * 16 % VAT and the total the buyer pays, plus the USD reference in English (Ω decision). It
 * shows only what the API confirmed; while a re-quote runs or after a failure it keeps the last
 * confirmed amounts and says so.
 */
export function CartSummary({
  locale,
  state,
  messages,
  priceMessages,
}: Readonly<CartSummaryProps>) {
  const titleId = useId();
  const { summary } = messages;
  const totals = state.quote?.summary;
  const plural = new Intl.PluralRules(locale).select(totals?.totalItems ?? 0);
  const status = statusText(state, summary);
  const usd =
    locale === 'en' && totals?.referenceUsdCents != null
      ? formatMoney(totals.referenceUsdCents, 'USD', locale)
      : null;
  return (
    <section
      aria-labelledby={titleId}
      className="rounded-xl border border-petroleo/15 bg-white/60 p-5"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        {summary.title}
      </h2>
      {totals && (
        <>
          <p className="mt-1 text-sm text-petroleo/80">
            {fill(plural === 'one' ? summary.items.one : summary.items.other, {
              count: totals.totalItems,
            })}
          </p>
          <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
            <dt>{summary.subtotal}</dt>
            <dd className="text-right">
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
