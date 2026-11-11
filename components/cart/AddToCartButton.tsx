'use client';

import { Backpack } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getCartStore } from '@/lib/cart/cartStore';
import { openCartPanel } from './useCart';

/** Props of {@link AddToCartButton}. */
interface AddToCartButtonProps {
  /** Product SKU (what the cart stores). */
  sku: string;
  /** Whether the product can be bought now. */
  inStock: boolean;
  /** Button label ("Agregar a la mochila"). */
  label: string;
  /** Label while out of stock ("Agotado"). */
  outOfStockLabel: string;
}

/**
 * "Add to pack" on the product page (FC 009). Adds one unit and opens the cart panel to confirm
 * it. The price is not sent: the cart quotes it from the server. Out of stock, the button is
 * disabled and says so.
 *
 * FC 045 (T1.1, T2.1): the static page ships the button before React attaches `onClick`, so a
 * click in that gap was lost (seen in WebKit, 364_AN). It is disabled in the prerendered HTML
 * and enabled once mounted, when in stock. The disabled style keeps its size: no layout shift.
 */
export function AddToCartButton({
  sku,
  inStock,
  label,
  outOfStockLabel,
}: Readonly<AddToCartButtonProps>) {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);
  return (
    <button
      type="button"
      disabled={!inStock || !isMounted}
      onClick={() => {
        getCartStore().addItem(sku);
        openCartPanel();
      }}
      className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-petroleo px-6 font-semibold text-marfil disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
    >
      <Backpack aria-hidden="true" size={20} />
      {inStock ? label : outOfStockLabel}
    </button>
  );
}
