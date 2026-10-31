'use client';

import { ShoppingBag } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { Locale, Messages } from '@/app/i18n';
import { fill } from '@/lib/catalog/format';
import { routeFor } from '@/lib/routes';
import { CartDrawer } from './CartDrawer';
import { useCartLines, useCartPanelRequests } from './useCart';

/** Props of {@link CartButton}. */
interface CartButtonProps {
  /** Language of the page. */
  locale: Locale;
  /** `cart` texts. */
  messages: Messages['cart'];
  /** `catalog.price` texts. */
  priceMessages: Messages['catalog']['price'];
}

/**
 * Header cart button with its unit counter (visible from launch with 0, Ω decision). It is a
 * real link to `/carrito/`, so it works without JavaScript; with JavaScript it opens the side
 * panel instead. The counter is an `<output>`: assistive technology hears it change.
 */
export function CartButton({
  locale,
  messages,
  priceMessages,
}: Readonly<CartButtonProps>) {
  const lines = useCartLines();
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  useCartPanelRequests(show);
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  const plural = new Intl.PluralRules(locale).select(units);
  const count = fill(
    plural === 'one' ? messages.count.one : messages.count.other,
    {
      count: units,
    }
  );
  return (
    <>
      <a
        href={routeFor('cart', locale)}
        onClick={(event) => {
          event.preventDefault();
          show();
        }}
        aria-label={`${messages.open}, ${count}`}
        className="tap-target relative shrink-0 justify-center"
      >
        <ShoppingBag aria-hidden="true" size={24} />
        <output
          aria-live="polite"
          className="absolute -top-0.5 -right-1 min-w-5 rounded-full bg-ocre px-1 text-center text-xs font-semibold text-petroleo"
        >
          {units}
        </output>
      </a>
      <CartDrawer
        open={open}
        onClose={() => setOpen(false)}
        locale={locale}
        messages={messages}
        priceMessages={priceMessages}
      />
    </>
  );
}
