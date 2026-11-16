import type { ReactNode } from 'react';
import type { Messages } from '@/app/i18n';
import type { AddressView } from '@/lib/account/addressTypes';
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

/**
 * The values of the address fields of the form for a saved address, or empty ones for «another
 * address» (FC 051 T1.4). The contact stays the buyer's own.
 *
 * @param address - The saved address, or null for none.
 * @returns The address fields of the form.
 */
export function addressValues(address: AddressView | null) {
  return {
    street: address?.street ?? '',
    exteriorNumber: address?.exteriorNumber ?? '',
    interiorNumber: address?.interiorNumber ?? '',
    neighborhood: address?.neighborhood ?? '',
    municipality: address?.municipality ?? '',
    postalCode: address?.postalCode ?? '',
    references: address?.references ?? '',
  };
}

/** The value of the choice «use another address». */
export const OTHER_ADDRESS = 'other';

/** Props of {@link SavedAddressPicker}. */
interface SavedAddressPickerProps {
  /** Id prefix of the radios. */
  id: string;
  /** The complete addresses of the buyer's book. */
  addresses: readonly AddressView[];
  /** The chosen address id, or {@link OTHER_ADDRESS}. */
  value: string | null;
  /** Called with the chosen address id, or {@link OTHER_ADDRESS}. */
  onChange: (choice: string) => void;
  /** Where the book is managed. */
  manageHref: string;
  /** `checkout.saved` texts. */
  messages: Messages['checkout']['saved'];
}

/**
 * The saved addresses of a signed-in buyer as a radio group (FC 051 T1.4): the default one comes
 * chosen, any other can be picked, and «use another address» leaves the form to be typed. The
 * order keeps its own copy of what is sent, so choosing here never links an order to the book.
 */
export function SavedAddressPicker({
  id,
  addresses,
  value,
  onChange,
  manageHref,
  messages,
}: Readonly<SavedAddressPickerProps>) {
  const option =
    'grid cursor-pointer grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-petroleo/20 bg-white/60 p-4 has-checked:border-petroleo has-checked:bg-white';
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="font-semibold">{messages.legend}</legend>
      {addresses.map((address) => (
        <label
          key={address.id}
          htmlFor={`${id}-${address.id}`}
          className={option}
        >
          <input
            id={`${id}-${address.id}`}
            type="radio"
            name={id}
            value={address.id}
            checked={value === address.id}
            onChange={() => onChange(address.id)}
            className="row-span-2 mt-1 size-5 shrink-0 accent-petroleo"
          />
          <span className="font-medium">
            {address.label ?? address.street}
            {address.isDefault && ` · ${messages.default}`}
          </span>
          <span className="text-sm text-petroleo/80">
            {`${address.street} ${address.exteriorNumber}, ${address.neighborhood}, ${address.postalCode}`}
          </span>
        </label>
      ))}
      <label htmlFor={`${id}-${OTHER_ADDRESS}`} className={option}>
        <input
          id={`${id}-${OTHER_ADDRESS}`}
          type="radio"
          name={id}
          value={OTHER_ADDRESS}
          checked={value === OTHER_ADDRESS}
          onChange={() => onChange(OTHER_ADDRESS)}
          className="mt-1 size-5 shrink-0 accent-petroleo"
        />
        <span className="font-medium">{messages.other}</span>
      </label>
      <a href={manageHref} className="tap-target self-start underline">
        {messages.manage}
      </a>
    </fieldset>
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
