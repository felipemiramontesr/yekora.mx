import { getMessages, type Locale } from '@/app/i18n';
import { CheckoutForm } from '../checkout/CheckoutForm';
import { OrderStatus } from '../checkout/OrderStatus';

/**
 * Checkout page body, shared by `/checkout/` and `/en/checkout/`. The cart lives in the
 * visitor's browser, so the prerendered page carries the heading and the empty state, and
 * hydrates with the stored cart.
 *
 * @param locale - Language of the page.
 */
export function CheckoutView({ locale }: Readonly<{ locale: Locale }>) {
  const { checkout, cart, catalog } = getMessages(locale);
  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-4xl font-semibold">{checkout.title}</h1>
      <p className="mt-3 text-petroleo/80">{checkout.intro}</p>
      <div className="mt-8">
        <CheckoutForm
          locale={locale}
          messages={checkout}
          cartMessages={cart}
          priceMessages={catalog.price}
        />
      </div>
    </div>
  );
}

/**
 * Body of the return pages: `/checkout/exito/` and `/en/checkout/success/` after paying,
 * `/checkout/cancelado/` and `/en/checkout/cancel/` after leaving the processor's page.
 *
 * @param locale - Language of the page.
 * @param variant - Which return.
 */
export function CheckoutReturnView({
  locale,
  variant,
}: Readonly<{ locale: Locale; variant: 'success' | 'cancel' }>) {
  const { checkout } = getMessages(locale);
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-4xl font-semibold">
        {checkout.return[variant].title}
      </h1>
      <div className="mt-8">
        <OrderStatus locale={locale} variant={variant} messages={checkout} />
      </div>
    </div>
  );
}
