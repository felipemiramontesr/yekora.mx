/**
 * Price and date presentation of the catalog (FC 008 F3), computed while prerendering so the
 * browser shows exactly what the build wrote (no hydration drift between ICU versions).
 *
 * Money arrives in integer cents from the API; the USD reference is already computed there
 * (`Math.round(price_mxn_cents / fix)`, apps/api/src/lib/money.ts), so this module only formats.
 *
 * @module
 */
import type { Locale } from '@/app/i18n';
import type { ExchangeRate, Product } from '@/lib/api/catalogClient';

/**
 * Money with its currency code, e.g. `$4,850.00 MXN` or `$262.16 USD`. The code is spelled out
 * because `$` alone is ambiguous between pesos and dollars.
 *
 * @param cents - Amount in cents.
 * @param currency - ISO 4217 code.
 * @param locale - Language of the page.
 */
export function formatMoney(
  cents: number,
  currency: 'MXN' | 'USD',
  locale: Locale
): string {
  const amount = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(cents / 100);
  return `${amount} ${currency}`;
}

/**
 * Banxico determination date in words, e.g. `16 de octubre de 2026` / `October 16, 2026`.
 *
 * @param isoDate - `YYYY-MM-DD`.
 * @param locale - Language of the page.
 */
function formatFixDate(isoDate: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/**
 * Replaces `{name}` placeholders of a dictionary text.
 *
 * @param template - Text with placeholders.
 * @param values - Value of each placeholder.
 */
export function fill(
  template: string,
  values: Record<string, string | number>
): string {
  return template.replaceAll(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match
  );
}

/** Prices of one product as the page shows them. */
export interface PriceText {
  /** Price charged, in pesos. */
  mxn: string;
  /** USD reference (English only, Ω decision), or null without a FIX. */
  usd: string | null;
}

/**
 * Prices of a product for one language. The USD reference shows only in English and only with a
 * FIX; otherwise the page shows pesos alone (FC 008).
 *
 * @param product - Product from the snapshot.
 * @param locale - Language of the page.
 */
export function priceText(product: Product, locale: Locale): PriceText {
  const usd =
    locale === 'en' && product.priceUsdCents !== null
      ? formatMoney(product.priceUsdCents, 'USD', locale)
      : null;
  return { mxn: formatMoney(product.priceMxnCents, 'MXN', locale), usd };
}

/**
 * The note under the prices: the FIX used for the USD reference (English with a FIX), or that
 * prices are in pesos.
 *
 * @param messages - `catalog.price` texts of the page's language.
 * @param rate - FIX of the snapshot, or null.
 * @param locale - Language of the page.
 */
export function priceNote(
  messages: { currencyNote: string; fxNote: string },
  rate: ExchangeRate | null,
  locale: Locale
): string {
  if (locale !== 'en' || rate === null) return messages.currencyNote;
  return fill(messages.fxNote, {
    date: formatFixDate(rate.date, locale),
    rate: rate.rate,
  });
}
