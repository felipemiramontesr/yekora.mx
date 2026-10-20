'use client';

import { Backpack } from 'lucide-react';
import type { Locale, Messages } from '@/app/i18n';
import { routeFor } from '@/lib/routes';
import { CartItemRow } from './CartItemRow';
import { CartSummary } from './CartSummary';
import { useCartLines, useCartQuote, useDeliveryState } from './useCart';

/** Props of {@link CartContents}. */
interface CartContentsProps {
  /** Language of the page. */
  locale: Locale;
  /** `cart` texts. */
  messages: Messages['cart'];
  /** `catalog.price` texts. */
  priceMessages: Messages['catalog']['price'];
}

/**
 * The cart itself, shared by the header panel and the `/carrito/` page: the branded empty state
 * (Ω: visible from launch, no "coming soon" notice), or the lines with their live quote and the
 * summary. Mounted only while shown, so a closed panel never asks the API for anything.
 */
export function CartContents({
  locale,
  messages,
  priceMessages,
}: Readonly<CartContentsProps>) {
  const lines = useCartLines();
  const [stateCode, setStateCode] = useDeliveryState();
  const state = useCartQuote(lines, locale, stateCode);
  if (lines.length === 0) {
    return (
      <div data-cart-empty className="flex flex-col items-start gap-4 py-6">
        <Backpack aria-hidden="true" size={40} className="text-ocre" />
        <p className="text-xl font-semibold">{messages.empty.title}</p>
        <p className="text-petroleo/80">{messages.empty.text}</p>
        <a
          href={routeFor('catalog', locale)}
          className="inline-flex min-h-11 items-center rounded-md bg-petroleo px-6 font-semibold text-marfil"
        >
          {messages.empty.cta}
        </a>
      </div>
    );
  }
  const quoted = new Map(state.quote?.items.map((item) => [item.sku, item]));
  return (
    <div className="flex flex-col gap-6">
      <ul>
        {lines.map((line) => (
          <CartItemRow
            key={line.sku}
            locale={locale}
            line={line}
            quoted={quoted.get(line.sku)}
            messages={messages.line}
          />
        ))}
      </ul>
      <CartSummary
        locale={locale}
        state={state}
        stateCode={stateCode}
        onStateChange={setStateCode}
        messages={messages}
        priceMessages={priceMessages}
      />
    </div>
  );
}
