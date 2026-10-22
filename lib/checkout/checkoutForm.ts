/**
 * Logic of the checkout form (FC 012 F3), kept out of the component so each rule is tested
 * alone: when the buyer may pay, and the request built and validated with the very schema the
 * API applies (ADR 0008), with each problem mapped to the field that shows it.
 *
 * @module
 */
import type { QuoteState } from '@/lib/api/cartClient';
import type { CartLine } from '@/lib/cart/cartTypes';
import {
  checkoutRequestSchema,
  type CheckoutRequest,
  type PAYMENT_METHOD_CODES,
} from './checkoutTypes';

/** A payment method code. */
export type PaymentMethodCode = (typeof PAYMENT_METHOD_CODES)[number];

/** What the buyer types, as typed. */
export interface CheckoutValues {
  name: string;
  email: string;
  phone: string;
  street: string;
  exteriorNumber: string;
  interiorNumber: string;
  neighborhood: string;
  municipality: string;
  postalCode: string;
  references: string;
}

/** An empty form. */
export const EMPTY_VALUES: CheckoutValues = {
  name: '',
  email: '',
  phone: '',
  street: '',
  exteriorNumber: '',
  interiorNumber: '',
  neighborhood: '',
  municipality: '',
  postalCode: '',
  references: '',
};

/** Fields that can show an error, in the order the form shows them (first one gets focus). */
export const FIELD_ORDER = [
  'name',
  'email',
  'phone',
  'street',
  'exteriorNumber',
  'interiorNumber',
  'neighborhood',
  'municipality',
  'stateCode',
  'postalCode',
  'references',
  'method',
  'consent',
] as const;

/** A field of the form. */
export type FieldName = (typeof FIELD_ORDER)[number];

/** Which message each field shows when invalid; the rest say the field is required. */
const MESSAGE_OF: Partial<Record<FieldName, string>> = {
  name: 'name',
  email: 'email',
  phone: 'phone',
  stateCode: 'state',
  postalCode: 'postalCode',
  method: 'method',
  consent: 'consent',
};

/** Invalid fields and the key of their message under `checkout.errors`. */
export type FieldErrors = Partial<Record<FieldName, string>>;

/** Everything the form holds when the buyer presses pay. */
interface FormInput {
  values: CheckoutValues;
  stateCode: string | null;
  method: PaymentMethodCode | null;
  consent: boolean;
  lines: readonly CartLine[];
  expectedTotalMxnCents: number;
}

const optional = (value: string) => (value.trim() === '' ? undefined : value);

/**
 * Builds the checkout request and validates it with the API's schema.
 *
 * @param input - Form values, delivery state, method, consent, cart lines and shown total.
 * @returns The request to send, or the invalid fields (consent is required here: the schema
 *   accepts `false` so that the API can answer PRIVACY_CONSENT_REQUIRED).
 */
export function validateCheckout(
  input: FormInput
): { ok: true; request: CheckoutRequest } | { ok: false; errors: FieldErrors } {
  const { values } = input;
  const parsed = checkoutRequestSchema.safeParse({
    items: input.lines,
    method: input.method,
    customer: { name: values.name, email: values.email, phone: values.phone },
    address: {
      street: values.street,
      exteriorNumber: values.exteriorNumber,
      interiorNumber: optional(values.interiorNumber),
      neighborhood: values.neighborhood,
      municipality: values.municipality,
      stateCode: input.stateCode ?? '',
      postalCode: values.postalCode,
      references: optional(values.references),
    },
    privacyConsent: input.consent,
    expectedTotalMxnCents: input.expectedTotalMxnCents,
  });
  const errors: FieldErrors = {};
  for (const issue of parsed.error?.issues ?? []) {
    const [head, field] = issue.path;
    const name = (
      head === 'customer' || head === 'address' ? field : head
    ) as FieldName;
    // Cart lines and the total come from the live quote, not from the buyer: no field shows them.
    if (FIELD_ORDER.includes(name))
      errors[name] = MESSAGE_OF[name] ?? 'required';
  }
  if (!input.consent) errors.consent = 'consent';
  return parsed.success && input.consent
    ? { ok: true, request: parsed.data }
    : { ok: false, errors };
}

/** Why the buyer cannot pay yet, or `ready`. */
type Readiness = 'ready' | 'quote' | 'shipping' | 'stock' | 'failed';

/**
 * Whether the cart's live quote allows paying: a state chosen and served, every line in stock
 * and a confirmed total. The server checks all of this again (T1.2); this only avoids sending a
 * request that is bound to be refused.
 *
 * @param state - Live quote of the cart.
 * @param stateCode - Delivery state chosen, or null.
 */
export function readiness(
  state: QuoteState,
  stateCode: string | null
): Readiness {
  if (stateCode === null || state.shippingIssue === 'invalid_destination') {
    return 'shipping';
  }
  if (state.shippingIssue === 'cart_unavailable') return 'stock';
  if (state.status === 'error') return 'failed';
  if (state.status !== 'ready' || state.quote === null) return 'quote';
  if (state.quote.warnings.length > 0) return 'stock';
  const { shippingCode } = state.quote.summary;
  return shippingCode === 'STANDARD_RATE' || shippingCode === 'FREE_SHIPPING'
    ? 'ready'
    : 'shipping';
}
