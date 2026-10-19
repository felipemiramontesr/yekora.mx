'use client';

import { Backpack } from 'lucide-react';
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
 */
export function AddToCartButton({
  sku,
  inStock,
  label,
  outOfStockLabel,
}: Readonly<AddToCartButtonProps>) {
  return (
    <button
      type="button"
      disabled={!inStock}
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
