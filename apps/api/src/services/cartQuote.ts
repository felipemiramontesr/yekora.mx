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
 * @module
 */
import { usdCents } from '../lib/money';
import type { Db } from './db';
import type { CurrentRate } from './exchangeRate';

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

/** The whole quote. */
interface CartQuote {
  items: QuotedLine[];
  summary: {
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

/**
 * Splits a net amount into its base and the 16 % VAT it carries, in integer cents.
 *
 * @param totalMxnCents - Net amount (VAT included).
 * @returns Base and tax; they always add up to the total.
 */
function splitVat(totalMxnCents: number): { base: number; tax: number } {
  const base = Math.round((totalMxnCents * 100) / 116);
  return { base, tax: totalMxnCents - base };
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
 * @returns Lines in request order, totals over purchasable lines, and warnings.
 */
function buildQuote(
  lines: readonly RequestedLine[],
  rows: readonly QuoteRow[],
  rate: CurrentRate | null,
  lang: 'es-MX' | 'en'
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
  // An empty total has no reference: the cart shows nothing to convert.
  const fix = rate ? Number(rate.rate) : null;
  const referenceUsdCents =
    summary.totalMxnCents > 0 ? usdCents(summary.totalMxnCents, fix) : null;
  return {
    items,
    summary: { ...summary, referenceUsdCents, exchangeRate: rate },
    warnings,
  };
}

/**
 * Quotes a cart against the catalog: one static, parameterized query for every SKU at once.
 * Inactive products, or products whose discipline or level is retired, read as unavailable,
 * exactly as the catalog hides them.
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
  const rows =
    lines.length === 0
      ? []
      : await db.query<QuoteRow>(
          'SELECT p.sku, p.slug, p.name_es, p.name_en, p.price_mxn_cents, p.stock FROM products p JOIN categories c ON c.id = p.category_id JOIN experience_levels l ON l.id = p.experience_level_id WHERE p.sku IN (?) AND p.is_active = 1 AND c.is_active = 1 AND l.is_active = 1',
          [lines.map((line) => line.sku)]
        );
  return buildQuote(lines, rows, rate, lang);
}
