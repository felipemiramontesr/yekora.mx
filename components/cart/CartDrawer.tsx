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
      // A click on the backdrop lands on the dialog itself, not on its content.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-y-0 right-0 left-auto m-0 h-full max-h-none w-full max-w-md overflow-y-auto bg-marfil p-0 text-petroleo backdrop:bg-petroleo/60"
    >
      {open && (
        <div className="flex min-h-full flex-col gap-4 p-5">
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
