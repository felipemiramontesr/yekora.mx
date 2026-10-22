'use client';

import { type FormEvent, useId, useState } from 'react';
import type { Locale, Messages } from '@/app/i18n';
import { type CheckoutFailure, submitCheckout } from '@/lib/api/checkoutClient';
import {
  type CheckoutValues,
  EMPTY_VALUES,
  FIELD_ORDER,
  type FieldErrors,
  type FieldName,
  type PaymentMethodCode,
  readiness,
  validateCheckout,
} from '@/lib/checkout/checkoutForm';
import { isGatewayUrl } from '@/lib/checkout/gateway';
import { rememberOrder } from '@/lib/checkout/orderAccess';
import { fill, formatMoney } from '@/lib/catalog/format';
import { routeFor } from '@/lib/routes';
import { CartSummary, StateSelect } from '../cart/CartSummary';
import { useCartLines, useCartQuote, useDeliveryState } from '../cart/useCart';
import { Field, FieldError, PaymentMethodPicker } from './CheckoutFields';

/** Props of {@link CheckoutForm}. */
interface CheckoutFormProps {
  /** Language of the page. */
  locale: Locale;
  /** `checkout` texts. */
  messages: Messages['checkout'];
  /** `cart` texts (the summary). */
  cartMessages: Messages['cart'];
  /** `catalog.price` texts. */
  priceMessages: Messages['catalog']['price'];
}

/** Refusals after which the total shown is stale: the cart is quoted again. */
const REQUOTE = new Set<CheckoutFailure>([
  'PRICE_CHANGED',
  'INSUFFICIENT_STOCK',
  'EMPTY_OR_UNAVAILABLE_CART',
  'UNSERVICEABLE_DESTINATION',
]);

type Phase =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'failed'; reason: CheckoutFailure };

/** The text inputs of the form, in order, with their browser hints. */
const TEXT_FIELDS: {
  name: keyof CheckoutValues;
  group: 'contact' | 'address';
  input: Parameters<typeof Field>[0]['input'];
}[] = [
  {
    name: 'name',
    group: 'contact',
    input: { autoComplete: 'name', maxLength: 120 },
  },
  {
    name: 'email',
    group: 'contact',
    input: { type: 'email', autoComplete: 'email', maxLength: 254 },
  },
  {
    name: 'phone',
    group: 'contact',
    input: {
      type: 'tel',
      autoComplete: 'tel-national',
      inputMode: 'numeric',
      maxLength: 10,
    },
  },
  {
    name: 'street',
    group: 'address',
    input: { autoComplete: 'address-line1', maxLength: 120 },
  },
  { name: 'exteriorNumber', group: 'address', input: { maxLength: 20 } },
  {
    name: 'interiorNumber',
    group: 'address',
    input: { autoComplete: 'address-line2', maxLength: 20 },
  },
  {
    name: 'neighborhood',
    group: 'address',
    input: { autoComplete: 'address-level3', maxLength: 120 },
  },
  {
    name: 'municipality',
    group: 'address',
    input: { autoComplete: 'address-level2', maxLength: 120 },
  },
  {
    name: 'postalCode',
    group: 'address',
    input: { autoComplete: 'postal-code', inputMode: 'numeric', maxLength: 5 },
  },
  { name: 'references', group: 'address', input: { maxLength: 200 } },
];

/** Element that receives focus for a field's error. */
function focusTarget(base: string, field: FieldName): string {
  return field === 'method' ? `${base}-method-CARD` : `${base}-${field}`;
}

/**
 * Guest checkout (FC 012 F3): contact, delivery address, payment method and consent, next to
 * the cart's live quote. The address's state is the remembered delivery state, so the total
 * always matches the address (the checkout address prevails, FC 012 §5). Paying validates with
 * the API's schema, asks `POST /v1/checkout`, keeps the order's access in this tab and goes to
 * the processor's page only if it is Stripe's or Mercado Pago's.
 */
export function CheckoutForm({
  locale,
  messages,
  cartMessages,
  priceMessages,
}: Readonly<CheckoutFormProps>) {
  const base = useId();
  const lines = useCartLines();
  const [stateCode, setStateCode] = useDeliveryState();
  const [revision, setRevision] = useState(0);
  const quote = useCartQuote(lines, locale, stateCode, revision);
  const [values, setValues] = useState<CheckoutValues>(EMPTY_VALUES);
  const [method, setMethod] = useState<PaymentMethodCode | null>(null);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  if (lines.length === 0) {
    return (
      <div data-checkout-empty className="flex flex-col items-start gap-4">
        <p className="text-xl font-semibold">{messages.empty.title}</p>
        <p className="text-petroleo/80">{messages.empty.text}</p>
        <a
          href={routeFor('catalog', locale)}
          className="inline-flex min-h-11 items-center rounded-md bg-petroleo px-6 font-semibold text-marfil"
        >
          {messages.empty.cta}
        </a>
      </div>
    );
  }

  const ready = readiness(quote, stateCode);
  const total = quote.quote?.summary.totalMxnCents ?? 0;
  const errorText = (field: FieldName) => {
    const key = errors[field];
    return key && messages.errors[key as keyof typeof messages.errors];
  };
  const update = (field: keyof CheckoutValues) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const check = validateCheckout({
      values,
      stateCode,
      method,
      consent,
      lines,
      expectedTotalMxnCents: total,
    });
    if (!check.ok) {
      setErrors(check.errors);
      // Every refusal names a field: the buyer's lines and total come from the cart itself.
      const [first] = FIELD_ORDER.filter((field) => check.errors[field]);
      document.getElementById(focusTarget(base, first))?.focus();
      return;
    }
    setErrors({});
    if (ready !== 'ready') return;
    setPhase({ kind: 'submitting' });
    const result = await submitCheckout(check.request, locale);
    if (result.ok && isGatewayUrl(result.session.redirectUrl)) {
      rememberOrder({
        orderNumber: result.session.orderNumber,
        accessToken: result.session.accessToken,
        redirectUrl: result.session.redirectUrl,
      });
      globalThis.location.assign(result.session.redirectUrl);
      return;
    }
    const reason = result.ok ? 'invalid' : result.reason;
    if (REQUOTE.has(reason)) setRevision((current) => current + 1);
    setPhase({ kind: 'failed', reason });
  }

  const submitting = phase.kind === 'submitting';
  const hasErrors = Object.keys(errors).length > 0;
  return (
    <form
      noValidate
      onSubmit={pay}
      className="grid gap-10 lg:grid-cols-[1fr_22rem] lg:items-start"
    >
      <div className="flex flex-col gap-8">
        {hasErrors && (
          <p role="alert" className="font-medium text-red-800">
            {messages.errors.summary}
          </p>
        )}
        {(['contact', 'address'] as const).map((group) => (
          <fieldset key={group} className="flex flex-col gap-4">
            <legend className="text-lg font-semibold">
              {messages[group].legend}
            </legend>
            {TEXT_FIELDS.filter((field) => field.group === group).map(
              ({ name, input }) => (
                <Field
                  key={name}
                  id={`${base}-${name}`}
                  label={(messages[group] as Record<string, string>)[name]}
                  hint={
                    (messages.contact as Record<string, string>)[`${name}Hint`]
                  }
                  error={errorText(name)}
                  value={values[name]}
                  onChange={update(name)}
                  input={input}
                />
              )
            )}
            {group === 'address' && (
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`${base}-stateCode`}
                  className="text-sm font-medium"
                >
                  {messages.address.state}
                </label>
                <StateSelect
                  id={`${base}-stateCode`}
                  locale={locale}
                  value={stateCode}
                  onChange={setStateCode}
                  placeholder={cartMessages.shipping.choose}
                  extra={{
                    autoComplete: 'address-level1',
                    'aria-invalid': errors.stateCode ? true : undefined,
                    'aria-describedby': errors.stateCode
                      ? `${base}-stateCode-error`
                      : undefined,
                  }}
                />
                {errors.stateCode && (
                  <FieldError id={`${base}-stateCode-error`}>
                    {errorText('stateCode')}
                  </FieldError>
                )}
              </div>
            )}
          </fieldset>
        ))}
        <PaymentMethodPicker
          id={`${base}-method`}
          value={method}
          onChange={setMethod}
          error={errorText('method')}
          messages={messages.method}
        />
        <div className="flex flex-col gap-1">
          <div className="flex items-start gap-3">
            <input
              id={`${base}-consent`}
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              aria-invalid={errors.consent ? true : undefined}
              aria-describedby={
                errors.consent ? `${base}-consent-error` : undefined
              }
              className="mt-1 size-5 shrink-0 accent-petroleo"
            />
            <label htmlFor={`${base}-consent`} className="text-sm">
              {messages.consent.before}
              <a
                href={routeFor('privacy', locale)}
                target="_blank"
                rel="noopener"
                className="underline"
              >
                {messages.consent.privacy}
              </a>
              {messages.consent.and}
              <a
                href={routeFor('terms', locale)}
                target="_blank"
                rel="noopener"
                className="underline"
              >
                {messages.consent.terms}
              </a>
              {messages.consent.after}
            </label>
          </div>
          {errors.consent && (
            <FieldError id={`${base}-consent-error`}>
              {errorText('consent')}
            </FieldError>
          )}
        </div>
      </div>
      <aside className="flex flex-col gap-4 lg:sticky lg:top-24">
        <CartSummary
          locale={locale}
          state={quote}
          stateCode={stateCode}
          onStateChange={setStateCode}
          messages={cartMessages}
          priceMessages={priceMessages}
          stateSelect={false}
        />
        <button
          type="submit"
          disabled={submitting || ready !== 'ready'}
          aria-describedby={`${base}-pay-status`}
          className="min-h-12 rounded-md bg-petroleo px-6 font-semibold text-marfil disabled:cursor-not-allowed disabled:opacity-60"
        >
          {fill(messages.pay, {
            total: formatMoney(total, 'MXN', locale),
          })}
        </button>
        <output
          id={`${base}-pay-status`}
          aria-live="polite"
          className="block text-sm"
        >
          {statusText(phase, ready, messages)}
        </output>
        <p className="text-xs text-petroleo/80">{messages.secure}</p>
        <a
          href={routeFor('cart', locale)}
          className="text-sm underline underline-offset-4"
        >
          {messages.backToCart}
        </a>
      </aside>
    </form>
  );
}

/** What the line under the pay button says: progress, the last refusal, or what is missing. */
function statusText(
  phase: Phase,
  ready: ReturnType<typeof readiness>,
  messages: Messages['checkout']
): string | null {
  if (phase.kind === 'submitting') return messages.submitting;
  if (phase.kind === 'failed') return messages.outcome[phase.reason];
  return ready === 'ready' ? null : messages.notReady[ready];
}
