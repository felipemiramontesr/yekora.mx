'use client';

import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Locale, Messages } from '@/app/i18n';
import { routeFor } from '@/lib/routes';
import { CartContents } from './CartContents';

/** Props of {@link CartDrawer}. */
interface CartDrawerProps {
  /** Whether the panel is shown. */
  open: boolean;
  /** Called when the buyer closes it (button, Esc or backdrop). */
  onClose: () => void;
  /** Language of the page. */
  locale: Locale;
  /** `cart` texts. */
  messages: Messages['cart'];
  /** `catalog.price` texts. */
  priceMessages: Messages['catalog']['price'];
}

/**
 * Side panel of the cart. A native modal `<dialog>`: the browser traps focus inside, closes it
 * with Esc and returns focus to the button that opened it, so it is accessible without extra
 * script. Its contents mount only while open.
 */
export function CartDrawer({
  open,
  onClose,
  locale,
  messages,
  priceMessages,
}: Readonly<CartDrawerProps>) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-label={messages.title}
      onClose={onClose}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none bg-transparent p-0 text-petroleo backdrop:bg-petroleo/60"
    >
      {/* The dimmed area is a real button, so "click outside to close" is an interactive
          element (S6847). Hidden from assistive tech and out of the tab order: the keyboard and screen
          readers close it with Esc or the "Cerrar" button. */}
      <button
        type="button"
        data-cart-backdrop
        tabIndex={-1}
        aria-hidden="true"
        aria-label={messages.close}
        onClick={onClose}
        className="absolute inset-0 size-full cursor-default"
      />
      {open && (
        <div className="relative ml-auto flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto bg-marfil p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-2xl font-semibold">{messages.title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={messages.close}
              className="inline-flex size-11 items-center justify-center rounded-md border border-petroleo/30"
            >
              <X aria-hidden="true" size={20} />
            </button>
          </div>
          <CartContents
            locale={locale}
            messages={messages}
            priceMessages={priceMessages}
          />
          <a
            href={routeFor('cart', locale)}
            className="mt-auto inline-flex min-h-11 items-center justify-center rounded-md border border-petroleo font-semibold"
          >
            {messages.viewFull}
          </a>
        </div>
      )}
    </dialog>
  );
}
