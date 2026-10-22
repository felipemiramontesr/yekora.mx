import type { InputHTMLAttributes, ReactNode } from 'react';
import type { Messages } from '@/app/i18n';
import type { PaymentMethodCode } from '@/lib/checkout/checkoutForm';
import { PAYMENT_METHOD_CODES } from '@/lib/checkout/checkoutTypes';

/** Props of {@link Field}. */
interface FieldProps {
  /** Input id; the hint and the error derive theirs from it. */
  id: string;
  /** Visible label. */
  label: string;
  /** Help under the field, or none. */
  hint?: string;
  /** Error text when invalid, or none. */
  error?: string;
  /** Current value. */
  value: string;
  /** Called with the new value. */
  onChange: (value: string) => void;
  /** Type, autocomplete, input mode, length and the like. */
  input?: Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'id' | 'value' | 'onChange'
  >;
}

/**
 * One labelled text input with its hint and its error, wired for assistive technology:
 * `aria-invalid` and `aria-describedby` point at the texts the field shows.
 */
export function Field({
  id,
  label,
  hint,
  error,
  value,
  onChange,
  input,
}: Readonly<FieldProps>) {
  const describedBy =
    [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') ||
    undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="min-h-11 rounded-md border border-petroleo/30 bg-white px-3 aria-invalid:border-red-700"
        {...input}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-petroleo/80">
          {hint}
        </p>
      )}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

/**
 * Error text of a field.
 *
 * @param id - Id the field's `aria-describedby` points at.
 */
export function FieldError({
  id,
  children,
}: Readonly<{ id: string; children: ReactNode }>) {
  return (
    <p id={id} className="text-sm font-medium text-red-800">
      {children}
    </p>
  );
}

/** Props of {@link PaymentMethodPicker}. */
interface PaymentMethodPickerProps {
  /** Id prefix of the radios. */
  id: string;
  /** Chosen method, or null. */
  value: PaymentMethodCode | null;
  /** Called with the chosen method. */
  onChange: (method: PaymentMethodCode) => void;
  /** Error text when no method was chosen, or none. */
  error?: string;
  /** `checkout.method` texts. */
  messages: Messages['checkout']['method'];
}

/**
 * The four payment methods (112_AN) as a radio group: card and OXXO by Stripe, SPEI and balance
 * by Mercado Pago. Nothing is preselected, so the buyer always chooses.
 */
export function PaymentMethodPicker({
  id,
  value,
  onChange,
  error,
  messages,
}: Readonly<PaymentMethodPickerProps>) {
  return (
    <fieldset
      aria-describedby={error ? `${id}-error` : `${id}-hold`}
      className="flex flex-col gap-3"
    >
      <legend className="text-lg font-semibold">{messages.legend}</legend>
      <p id={`${id}-hold`} className="text-sm text-petroleo/80">
        {messages.hold}
      </p>
      {PAYMENT_METHOD_CODES.map((code) => {
        const option = messages.options[code];
        return (
          <label
            key={code}
            htmlFor={`${id}-${code}`}
            className="flex cursor-pointer gap-3 rounded-lg border border-petroleo/20 bg-white/60 p-4 has-checked:border-petroleo has-checked:bg-white"
          >
            <input
              id={`${id}-${code}`}
              type="radio"
              name={id}
              value={code}
              checked={value === code}
              onChange={() => onChange(code)}
              className="mt-1 size-5 shrink-0 accent-petroleo"
            />
            <span className="flex flex-col gap-1">
              <span className="font-medium">{option.label}</span>
              <span className="text-sm text-petroleo/80">{option.detail}</span>
            </span>
          </label>
        );
      })}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </fieldset>
  );
}
