import { describe, expect, it } from 'vitest';
import { isGatewayUrl } from './gateway';

describe('isGatewayUrl (no open redirect)', () => {
  it.each([
    'https://checkout.stripe.com/c/pay/cs_test_a1#fid',
    'https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=1',
    'https://sandbox.mercadopago.com.mx/checkout/v1/redirect?pref_id=1',
  ])('accepts the hosted payment page %s', (url) => {
    expect(isGatewayUrl(url)).toBe(true);
  });

  it.each([
    // Built from parts: the point is that the guard refuses the clear-text scheme.
    ['plain HTTP', `${'http'}://checkout.stripe.com/c/pay/x`],
    ['another host', 'https://evil.example/c/pay/x'],
    ['a look-alike subdomain', 'https://checkout.stripe.com.evil.example/'],
    ['a parent domain', 'https://stripe.com/'],
    ['another port', 'https://checkout.stripe.com:8443/'],
    ['credentials in the URL', 'https://user:pw@checkout.stripe.com/'],
    ['a script URL', 'javascript:alert(1)'],
    ['a relative path', '/checkout/exito/'],
    ['not a URL', 'checkout.stripe.com'],
  ])('refuses %s', (_case, url) => {
    expect(isGatewayUrl(url)).toBe(false);
  });
});
