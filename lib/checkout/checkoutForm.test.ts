import { describe, expect, it } from 'vitest';
import type { QuoteState } from '@/lib/api/cartClient';
import type { CartQuote } from '@/lib/cart/cartTypes';
import {
  type CheckoutValues,
  EMPTY_VALUES,
  readiness,
  validateCheckout,
} from './checkoutForm';

const VALUES: CheckoutValues = {
  name: 'Ana Flores',
  email: 'ana@example.com',
  phone: '4929421780',
  street: 'Av. Barones',
  exteriorNumber: '209',
  interiorNumber: '',
  neighborhood: 'Las Américas',
  municipality: 'Guadalupe',
  postalCode: '98612',
  references: '  ',
};

const input = (over: Partial<Parameters<typeof validateCheckout>[0]> = {}) => ({
  values: VALUES,
  stateCode: 'ZAC',
  method: 'OXXO' as const,
  consent: true,
  lines: [{ sku: 'TENT', quantity: 1 }],
  expectedTotalMxnCents: 200000,
  ...over,
});

describe('validateCheckout (the API schema, applied before sending)', () => {
  it('builds the request, leaving out the empty optional fields', () => {
    expect(validateCheckout(input())).toEqual({
      ok: true,
      request: {
        items: [{ sku: 'TENT', quantity: 1 }],
        method: 'OXXO',
        customer: {
          name: 'Ana Flores',
          email: 'ana@example.com',
          phone: '4929421780',
        },
        address: {
          street: 'Av. Barones',
          exteriorNumber: '209',
          neighborhood: 'Las Américas',
          municipality: 'Guadalupe',
          stateCode: 'ZAC',
          postalCode: '98612',
        },
        privacyConsent: true,
        expectedTotalMxnCents: 200000,
      },
    });
  });

  it('sends the optional fields when given', () => {
    const result = validateCheckout(
      input({
        values: { ...VALUES, interiorNumber: '3B', references: 'Portón negro' },
      })
    );
    expect(result.ok && result.request.address).toMatchObject({
      interiorNumber: '3B',
      references: 'Portón negro',
    });
  });

  it('maps every problem of an empty form to its field and message', () => {
    expect(
      validateCheckout(
        input({
          values: EMPTY_VALUES,
          stateCode: null,
          method: null,
          consent: false,
        })
      )
    ).toEqual({
      ok: false,
      errors: {
        name: 'name',
        email: 'email',
        phone: 'phone',
        street: 'required',
        exteriorNumber: 'required',
        neighborhood: 'required',
        municipality: 'required',
        stateCode: 'state',
        postalCode: 'postalCode',
        method: 'method',
        consent: 'consent',
      },
    });
  });

  it('requires the consent although the schema accepts false', () => {
    expect(validateCheckout(input({ consent: false }))).toEqual({
      ok: false,
      errors: { consent: 'consent' },
    });
  });

  it('shows no field for problems the buyer did not type (lines, total)', () => {
    expect(
      validateCheckout(input({ lines: [], expectedTotalMxnCents: -1 }))
    ).toEqual({ ok: false, errors: {} });
  });
});

const quote = (
  over: Partial<CartQuote['summary']> = {},
  warnings: CartQuote['warnings'] = []
) =>
  ({
    items: [],
    summary: { shippingCode: 'STANDARD_RATE', totalMxnCents: 200000, ...over },
    warnings,
  }) as unknown as CartQuote;

const state = (over: Partial<QuoteState> = {}): QuoteState => ({
  status: 'ready',
  quote: quote(),
  error: null,
  shippingIssue: null,
  ...over,
});

describe('readiness (may the buyer pay now?)', () => {
  it.each([
    ['no state chosen', state(), null, 'shipping'],
    [
      'a state the API does not know',
      state({ shippingIssue: 'invalid_destination' }),
      'ZAC',
      'shipping',
    ],
    [
      'lines that cannot be bought',
      state({ shippingIssue: 'cart_unavailable' }),
      'ZAC',
      'stock',
    ],
    [
      'a failed quote',
      state({ status: 'error', error: 'server' }),
      'ZAC',
      'failed',
    ],
    ['a quote on its way', state({ status: 'loading' }), 'ZAC', 'quote'],
    ['no quote yet', state({ status: 'idle', quote: null }), 'ZAC', 'quote'],
    [
      'a line short on stock',
      state({ quote: quote({}, [{ sku: 'T', code: 'insufficient_stock' }]) }),
      'ZAC',
      'stock',
    ],
    [
      'a state not served',
      state({ quote: quote({ shippingCode: 'UNSERVICEABLE_DESTINATION' }) }),
      'JAL',
      'shipping',
    ],
    ['standard shipping', state(), 'ZAC', 'ready'],
    [
      'free shipping',
      state({ quote: quote({ shippingCode: 'FREE_SHIPPING' }) }),
      'ZAC',
      'ready',
    ],
  ] as const)('%s → %s', (_case, quoteState, stateCode, expected) => {
    expect(readiness(quoteState, stateCode)).toBe(expected);
  });
});
