import type { ReactNode } from 'react';
import type { Messages } from '@/app/i18n';
import type { PaymentMethodCode } from '@/lib/checkout/checkoutForm';
import { PAYMENT_METHOD_CODES } from '@/lib/checkout/checkoutTypes';

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
            className="grid cursor-pointer grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-petroleo/20 bg-white/60 p-4 has-checked:border-petroleo has-checked:bg-white"
          >
            {/* Flat grid (input spanning both rows, then the two texts) keeps the label text a
                direct child, so its accessible name is found without nesting. */}
            <input
              id={`${id}-${code}`}
              type="radio"
              name={id}
              value={code}
              checked={value === code}
              onChange={() => onChange(code)}
              className="row-span-2 mt-1 size-5 shrink-0 accent-petroleo"
            />
            <span className="font-medium">{option.label}</span>
            <span className="text-sm text-petroleo/80">{option.detail}</span>
          </label>
        );
      })}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </fieldset>
  );
}
