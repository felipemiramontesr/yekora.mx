/**
 * Canonical cart quote (FC 009 F1, ADR 0008, Ω decisions in 073_AN).
 *
 * The server is the only authority on price, VAT and stock: the browser sends SKUs and
 * quantities, never amounts. `products.price_mxn_cents` is the **net** price, VAT included
 * (what the buyer sees and pays). Per line, in integer cents:
 *
 *   lineTotal = unitPrice × quantity                  (exact: what the product page promised)
 *   lineBase  = round(lineTotal × 100 / 116)          (16 % VAT carried inside the net price)
 *   lineTax   = lineTotal − lineBase                  (so base + tax = total, by construction)
 *
 * Only lines that can be bought now count toward the totals (active product, stock covers the
 * quantity). The rest come back flagged with a warning and the quantity that is left, so the
 * total never promises what cannot be sold. Static SQL with `?` placeholders only (T1.1 of
 * FC 008): mysql2 expands the SKU array of `IN (?)` with escaping.
 *
 * Shipping (FC 011): without a destination the quote is the products alone (shipping null,
 * serviceable). With one, {@link quoteCartToDestination} applies truth table T1.1 in order:
 * V the cart is quotable (at least one line, every line purchasable) else
 * EMPTY_OR_UNAVAILABLE_CART; D the state is a known zone else INVALID_DESTINATION; R a rule
 * covers the purchase else 200 with UNSERVICEABLE_DESTINATION and a zero charge. The charge is
 * one more line of the summary, split with the same VAT rule, and the grand totals add it.
 *
 * @module
 */
import { splitVat, usdCents } from '../lib/money';
import type { Db } from './db';
import type { CurrentRate } from './exchangeRate';
import type { ShippingRateProvider } from './shippingPort';

/** Stock below this is reported as low (FC 009 T1.2). */
const LOW_STOCK = 5;
/** Largest quantity a line may ask for (mirrors the request schema). */
const MAX_QUANTITY = 99;

/** Why a line cannot be bought now. */
type QuoteWarningCode = 'unavailable' | 'out_of_stock' | 'insufficient_stock';

/** Availability of one line. */
type StockStatus = 'available' | 'low_stock' | 'out_of_stock' | 'unavailable';

/** A product as the quote reads it. */
interface QuoteRow {
  sku: string;
  slug: string;
  name_es: string;
  name_en: string;
  price_mxn_cents: number;
  stock: number;
  weight_grams: number;
  length_mm: number;
  width_mm: number;
  height_mm: number;
  shipping_class_id: number;
}

/** One requested line: what the browser keeps (no amounts). */
interface RequestedLine {
  sku: string;
  quantity: number;
}

/** One quoted line. Amounts are null when the product cannot be sold at all. */
interface QuotedLine {
  sku: string;
  slug: string | null;
  name: string | null;
  quantity: number;
  unitPriceMxnCents: number | null;
  lineTotalMxnCents: number | null;
  lineBaseMxnCents: number | null;
  lineTaxMxnCents: number | null;
  stockStatus: StockStatus;
  /** How many can be bought now (0 to 99): lets the cart offer to adjust the quantity. */
  availableQuantity: number;
  /** Whether the line counts toward the totals. */
  purchasable: boolean;
}

/** Effect of the shipping evaluation shown with the quote. */
type ShippingCode =
  'STANDARD_RATE' | 'FREE_SHIPPING' | 'UNSERVICEABLE_DESTINATION';

/** Charge of the shipment, already split; null when no destination was given. */
type ShippingLine = {
  code: ShippingCode;
  base: number;
  tax: number;
  total: number;
  remaining: number | null;
} | null;

/** The whole quote. */
interface CartQuote {
  items: QuotedLine[];
  summary: {
    /** Purchasable lines only: base, VAT and total with VAT. */
    itemsBaseMxnCents: number;
    itemsTaxMxnCents: number;
    itemsTotalMxnCents: number;
    /** Null without a destination; otherwise the T1.1/T1.2 effect. */
    shippingCode: ShippingCode | null;
    /** Charge split like a product line; null without a destination, 0 when not covered. */
    shippingBaseMxnCents: number | null;
    shippingTaxMxnCents: number | null;
    shippingTotalMxnCents: number | null;
    /** False only when a destination was given and no rule covers it. */
    serviceable: boolean;
    /** Items total still missing for free shipping; null when it does not apply. */
    freeShippingRemainingMxnCents: number | null;
    /** Grand totals: items plus shipping. */
    subtotalMxnCents: number;
    taxMxnCents: number;
    totalMxnCents: number;
    /** Units across purchasable lines. */
    totalItems: number;
    referenceUsdCents: number | null;
    exchangeRate: CurrentRate | null;
  };
  warnings: { sku: string; code: QuoteWarningCode }[];
}

function stockStatus(stock: number): StockStatus {
  if (stock <= 0) return 'out_of_stock';
  return stock < LOW_STOCK ? 'low_stock' : 'available';
}

function quoteLine(
  line: RequestedLine,
  row: QuoteRow | undefined,
  lang: 'es-MX' | 'en'
): {
  quoted: QuotedLine;
  warning?: QuoteWarningCode;
  /** Amounts that count toward the totals: only for a line that can be bought now. */
  counted?: { base: number; tax: number; total: number };
} {
  if (!row) {
    return {
      quoted: {
        sku: line.sku,
        slug: null,
        name: null,
        quantity: line.quantity,
        unitPriceMxnCents: null,
        lineTotalMxnCents: null,
        lineBaseMxnCents: null,
        lineTaxMxnCents: null,
        stockStatus: 'unavailable',
        availableQuantity: 0,
        purchasable: false,
      },
      warning: 'unavailable',
    };
  }
  const unit = Number(row.price_mxn_cents);
  const stock = Number(row.stock);
  const total = unit * line.quantity;
  const { base, tax } = splitVat(total);
  const status = stockStatus(stock);
  const purchasable = stock >= line.quantity;
  let warning: QuoteWarningCode | undefined;
  if (status === 'out_of_stock') warning = 'out_of_stock';
  else if (!purchasable) warning = 'insufficient_stock';
  return {
    quoted: {
      sku: row.sku,
      slug: row.slug,
      name: lang === 'en' ? row.name_en : row.name_es,
      quantity: line.quantity,
      unitPriceMxnCents: unit,
      lineTotalMxnCents: total,
      lineBaseMxnCents: base,
      lineTaxMxnCents: tax,
      stockStatus: status,
      availableQuantity: Math.min(Math.max(stock, 0), MAX_QUANTITY),
      purchasable,
    },
    warning,
    counted: purchasable ? { base, tax, total } : undefined,
  };
}

/**
 * Builds the quote from the products read (pure: no database).
 *
 * @param lines - Requested lines, in the browser's order.
 * @param rows - Active products found for those SKUs.
 * @param rate - Current FIX, or null.
 * @param lang - Language of the product names.
 * @param shipping - Priced shipment, or null without a destination.
 * @returns Lines in request order, totals over purchasable lines plus shipping, and warnings.
 */
function buildQuote(
  lines: readonly RequestedLine[],
  rows: readonly QuoteRow[],
  rate: CurrentRate | null,
  lang: 'es-MX' | 'en',
  shipping: ShippingLine = null
): CartQuote {
  const bySku = new Map(rows.map((row) => [row.sku, row]));
  const items: QuotedLine[] = [];
  const warnings: CartQuote['warnings'] = [];
  const summary = {
    subtotalMxnCents: 0,
    taxMxnCents: 0,
    totalMxnCents: 0,
    totalItems: 0,
  };
  for (const line of lines) {
    const { quoted, warning, counted } = quoteLine(
      line,
      bySku.get(line.sku),
      lang
    );
    items.push(quoted);
    if (warning) warnings.push({ sku: line.sku, code: warning });
    if (counted) {
      summary.subtotalMxnCents += counted.base;
      summary.taxMxnCents += counted.tax;
      summary.totalMxnCents += counted.total;
      summary.totalItems += quoted.quantity;
    }
  }
  const totalMxnCents = summary.totalMxnCents + (shipping?.total ?? 0);
  // An empty total has no reference: the cart shows nothing to convert.
  const fix = rate ? Number(rate.rate) : null;
  const referenceUsdCents =
    totalMxnCents > 0 ? usdCents(totalMxnCents, fix) : null;
  return {
    items,
    summary: {
      itemsBaseMxnCents: summary.subtotalMxnCents,
      itemsTaxMxnCents: summary.taxMxnCents,
      itemsTotalMxnCents: summary.totalMxnCents,
      shippingCode: shipping?.code ?? null,
      shippingBaseMxnCents: shipping?.base ?? null,
      shippingTaxMxnCents: shipping?.tax ?? null,
      shippingTotalMxnCents: shipping?.total ?? null,
      serviceable: shipping?.code !== 'UNSERVICEABLE_DESTINATION',
      freeShippingRemainingMxnCents: shipping?.remaining ?? null,
      subtotalMxnCents: summary.subtotalMxnCents + (shipping?.base ?? 0),
      taxMxnCents: summary.taxMxnCents + (shipping?.tax ?? 0),
      totalMxnCents,
      totalItems: summary.totalItems,
      referenceUsdCents,
      exchangeRate: rate,
    },
    warnings,
  };
}

/** Reads the active products of the requested SKUs in one static, parameterized query. */
async function readProducts(
  db: Db,
  lines: readonly RequestedLine[]
): Promise<QuoteRow[]> {
  if (lines.length === 0) return [];
  return db.query<QuoteRow>(
    'SELECT p.sku, p.slug, p.name_es, p.name_en, p.price_mxn_cents, p.stock, p.weight_grams, p.length_mm, p.width_mm, p.height_mm, p.shipping_class_id FROM products p JOIN categories c ON c.id = p.category_id JOIN experience_levels l ON l.id = p.experience_level_id WHERE p.sku IN (?) AND p.is_active = 1 AND c.is_active = 1 AND l.is_active = 1',
    [lines.map((line) => line.sku)]
  );
}

/**
 * Quotes a cart against the catalog, products only (no destination: shipping null). Inactive
 * products, or products whose discipline or level is retired, read as unavailable, exactly as
 * the catalog hides them.
 *
 * @param db - Database port.
 * @param lines - Validated lines (unique SKUs).
 * @param rate - Current FIX, or null.
 * @param lang - Language of the product names.
 */
export async function quoteCart(
  db: Db,
  lines: readonly RequestedLine[],
  rate: CurrentRate | null,
  lang: 'es-MX' | 'en'
): Promise<CartQuote> {
  return buildQuote(lines, await readProducts(db, lines), rate, lang);
}

/** Why a quote with a destination is refused (T1.1 rows with HTTP 400). */
type DestinationRejection = 'EMPTY_OR_UNAVAILABLE_CART' | 'INVALID_DESTINATION';

/**
 * Quotes a cart with its shipping to a destination (FC 011, T1.1 in order V, D, R). The same
 * quote as {@link quoteCart} plus one shipping line, priced once for the whole purchase by the
 * provider; the browser never sends an amount.
 *
 * @param db - Database port.
 * @param lines - Validated lines (unique SKUs).
 * @param rate - Current FIX, or null.
 * @param lang - Language of the product names.
 * @param destination - State code (ISO 3166-2:MX without MX-) and optional postal code.
 * @param provider - Source of shipping rates.
 * @returns The quote, or the T1.1 rejection when the cart or the state cannot be quoted.
 */
export async function quoteCartToDestination(
  db: Db,
  lines: readonly RequestedLine[],
  rate: CurrentRate | null,
  lang: 'es-MX' | 'en',
  destination: { stateCode: string; postalCode?: string },
  provider: ShippingRateProvider
): Promise<
  { ok: true; quote: CartQuote } | { ok: false; code: DestinationRejection }
> {
  const rows = await readProducts(db, lines);
  const products = buildQuote(lines, rows, rate, lang);
  // V: at least one line and every line purchasable now; checked before the destination.
  if (lines.length === 0 || products.items.some((item) => !item.purchasable)) {
    return { ok: false, code: 'EMPTY_OR_UNAVAILABLE_CART' };
  }
  const bySku = new Map(rows.map((row) => [row.sku, row]));
  const shipment = await provider.quote({
    stateCode: destination.stateCode,
    itemsTotalMxnCents: products.summary.itemsTotalMxnCents,
    lines: lines.map((line) => {
      // V guarantees every line was read: a purchasable line has its row.
      const row = bySku.get(line.sku) as QuoteRow;
      return {
        quantity: line.quantity,
        weightGrams: Number(row.weight_grams),
        lengthMm: Number(row.length_mm),
        widthMm: Number(row.width_mm),
        heightMm: Number(row.height_mm),
        classId: Number(row.shipping_class_id),
      };
    }),
  });
  if (shipment.code === 'INVALID_DESTINATION') {
    return { ok: false, code: 'INVALID_DESTINATION' };
  }
  const shipping: ShippingLine = shipment.serviceable
    ? {
        code: shipment.code,
        base: shipment.baseMxnCents,
        tax: shipment.taxMxnCents,
        total: shipment.totalMxnCents,
        remaining: shipment.freeShippingRemainingMxnCents,
      }
    : {
        code: 'UNSERVICEABLE_DESTINATION',
        base: 0,
        tax: 0,
        total: 0,
        remaining: null,
      };
  return { ok: true, quote: buildQuote(lines, rows, rate, lang, shipping) };
}
