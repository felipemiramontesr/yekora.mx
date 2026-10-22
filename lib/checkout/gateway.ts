/**
 * The only places the checkout sends the buyer to (FC 012 F3): the hosted payment pages of
 * Stripe and Mercado Pago. The redirect URL comes from our API, but the browser checks it again
 * before `location.assign`, so a tampered or broken answer can never navigate the buyer to an
 * arbitrary site (open redirect).
 *
 * @module
 */

/** Hosts of the hosted payment pages: Stripe Checkout, and Mercado Pago (live and sandbox). */
const GATEWAY_HOSTS = new Set([
  'checkout.stripe.com',
  'www.mercadopago.com.mx',
  'sandbox.mercadopago.com.mx',
]);

/**
 * Whether a URL is a hosted payment page we send buyers to: HTTPS, default port, no
 * credentials, and one of the processor hosts exactly.
 *
 * @param raw - URL as received from the API.
 */
export function isGatewayUrl(raw: string): boolean {
  if (!URL.canParse(raw)) return false;
  const url = new URL(raw);
  return (
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    GATEWAY_HOSTS.has(url.hostname)
  );
}
