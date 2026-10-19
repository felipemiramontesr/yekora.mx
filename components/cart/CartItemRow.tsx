'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import type { Locale, Messages } from '@/app/i18n';
import { fill, formatMoney } from '@/lib/catalog/format';
import type { CartLine, CartQuote } from '@/lib/cart/cartTypes';
import { MAX_QUANTITY } from '@/lib/cart/cartTypes';
import { getCartStore } from '@/lib/cart/cartStore';

type QuotedItem = CartQuote['items'][number];

/** Props of {@link CartItemRow}. */
interface CartItemRowProps {
  /** Language of the page. */
  locale: Locale;
  /** The stored line (SKU and quantity). */
  line: CartLine;
  /** Its quoted counterpart, once the API answered. */
  quoted: QuotedItem | undefined;
  /** `cart.line` texts. */
  messages: Messages['cart']['line'];
}

// Why the line cannot be bought now, from the quote.
function problem(
  quoted: QuotedItem | undefined,
  locale: Locale,
  messages: Messages['cart']['line']
): string | null {
  if (!quoted || quoted.purchasable) return null;
  if (quoted.stockStatus === 'unavailable') return messages.unavailable;
  if (quoted.stockStatus === 'out_of_stock') return messages.outOfStock;
  const plural = new Intl.PluralRules(locale).select(quoted.availableQuantity);
  return fill(
    plural === 'one' ? messages.insufficient.one : messages.insufficient.other,
    { count: quoted.availableQuantity }
  );
}

const STEP =
  'inline-flex size-11 items-center justify-center rounded-md border border-petroleo/30 disabled:opacity-40';

/**
 * One cart line: name, unit price, quantity controls, line total (from the quote), and what to
 * do when it cannot be bought (unavailable, out of stock, or fewer units left, with a one-click
 * adjustment). Every control is at least 44 px and named after the product.
 */
export function CartItemRow({
  locale,
  line,
  quoted,
  messages,
}: Readonly<CartItemRowProps>) {
  const cart = getCartStore();
  const name = quoted?.name ?? line.sku;
  const issue = problem(quoted, locale, messages);
  const canAdjust =
    quoted !== undefined && !quoted.purchasable && quoted.availableQuantity > 0;
  return (
    <li className="flex flex-col gap-3 border-b border-petroleo/15 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold">{name}</p>
          {quoted?.unitPriceMxnCents != null && (
            <p className="text-sm text-petroleo/80">
              {fill(messages.each, {
                price: formatMoney(quoted.unitPriceMxnCents, 'MXN', locale),
              })}
            </p>
          )}
        </div>
        {quoted?.purchasable && quoted.lineTotalMxnCents != null && (
          <p className="font-semibold">
            {formatMoney(quoted.lineTotalMxnCents, 'MXN', locale)}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={STEP}
          aria-label={fill(messages.decrease, { name })}
          disabled={line.quantity <= 1}
          onClick={() => cart.updateQuantity(line.sku, line.quantity - 1)}
        >
          <Minus aria-hidden="true" size={18} />
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_QUANTITY}
          value={line.quantity}
          aria-label={fill(messages.quantity, { name })}
          onChange={(event) =>
            cart.updateQuantity(line.sku, Number(event.target.value))
          }
          className="h-11 w-16 rounded-md border border-petroleo/30 bg-white text-center"
        />
        <button
          type="button"
          className={STEP}
          aria-label={fill(messages.increase, { name })}
          disabled={line.quantity >= MAX_QUANTITY}
          onClick={() => cart.updateQuantity(line.sku, line.quantity + 1)}
        >
          <Plus aria-hidden="true" size={18} />
        </button>
        <button
          type="button"
          className={`${STEP} ml-auto`}
          aria-label={fill(messages.remove, { name })}
          onClick={() => cart.removeItem(line.sku)}
        >
          <Trash2 aria-hidden="true" size={18} />
        </button>
      </div>
      {issue && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <p className="font-semibold text-red-800">{issue}</p>
          {canAdjust && (
            <button
              type="button"
              className="min-h-11 rounded-md border border-petroleo px-4 font-semibold"
              onClick={() =>
                cart.updateQuantity(line.sku, quoted.availableQuantity)
              }
            >
              {fill(messages.adjust, { count: quoted.availableQuantity })}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
