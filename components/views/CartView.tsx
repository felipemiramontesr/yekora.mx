import { getMessages, type Locale } from '@/app/i18n';
import { CartContents } from '../cart/CartContents';

/**
 * Cart page body, shared by `/carrito/` and `/en/cart/`. The content lives in the visitor's
 * browser, so the prerendered page carries the heading and an empty cart, and hydrates with the
 * stored one.
 *
 * @param locale - Language of the page.
 */
export function CartView({ locale }: Readonly<{ locale: Locale }>) {
  const { cart, catalog } = getMessages(locale);
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-4xl font-semibold">{cart.title}</h1>
      <div className="mt-8">
        <CartContents
          locale={locale}
          messages={cart}
          priceMessages={catalog.price}
        />
      </div>
    </div>
  );
}
