'use client';

import {
  type SubmitEvent,
  useCallback,
  useEffect,
  useId,
  useState,
} from 'react';
import type { Locale, Messages } from '@/app/i18n';
import {
  type AddressView,
  addressUpsertRequestSchema,
  profileUpdateRequestSchema,
} from '@/lib/account/addressTypes';
import type { MeResponse } from '@/lib/account/authTypes';
import { syncHeaderUser } from '@/lib/account/headerSession';
import {
  type AccountDataFailure,
  createAddress,
  deleteAddress,
  listAddresses,
  updateAddress,
  updateProfile,
} from '@/lib/api/accountDataClient';
import { getDestinationStore } from '@/lib/cart/destinationStore';
import { MEXICAN_STATES } from '@/lib/cart/mxStates';
import { stateOfPostalCode } from '@/lib/cart/postalRanges';
import { fill } from '@/lib/catalog/format';
import { TextField } from '../ui/TextField';

/** `account.data` texts. */
type DataTexts = Messages['account']['data'];

/** What the page says after an action: a confirmation or the refusal. */
type Note = { kind: 'ok' | 'error'; text: string } | null;

/** The book as the API answers it. */
interface Book {
  items: AddressView[];
  max: number;
}

/** The fields of the address form, as typed. */
const ADDRESS_FIELDS = [
  'label',
  'name',
  'phone',
  'street',
  'exteriorNumber',
  'interiorNumber',
  'neighborhood',
  'municipality',
  'postalCode',
  'references',
] as const;

/** One field of the address form. */
type AddressField = (typeof ADDRESS_FIELDS)[number];

/** What the address form holds. */
type AddressValues = Record<AddressField, string>;

/** Browser hints and limits of each field of the address form. */
const ADDRESS_INPUT: Record<AddressField, Record<string, string | number>> = {
  label: { maxLength: 40 },
  name: { autoComplete: 'name', maxLength: 120 },
  phone: {
    type: 'tel',
    autoComplete: 'tel-national',
    inputMode: 'numeric',
    maxLength: 10,
  },
  street: { autoComplete: 'address-line1', maxLength: 120 },
  exteriorNumber: { maxLength: 20 },
  interiorNumber: { autoComplete: 'address-line2', maxLength: 20 },
  neighborhood: { autoComplete: 'address-level3', maxLength: 120 },
  municipality: { autoComplete: 'address-level2', maxLength: 120 },
  postalCode: {
    autoComplete: 'postal-code',
    inputMode: 'numeric',
    maxLength: 5,
  },
  references: { maxLength: 200 },
};

/** The message of a refusal: the page names every reason the client can give. */
function failureText(texts: DataTexts, reason: AccountDataFailure): string {
  return texts.errors[reason];
}

/** The name of a state in the page's language. */
function stateName(code: string, locale: Locale): string {
  const state = MEXICAN_STATES.find((option) => option.code === code);
  if (!state) return code;
  return locale === 'en' ? state.en : state.es;
}

/**
 * The values the address form starts with: the address being edited, or a new one for this
 * person. What an address does not hold yet (the one given at sign-up) is the person's own name and
 * phone.
 */
function initialValues(
  address: AddressView | undefined,
  user: MeResponse
): AddressValues {
  return {
    label: address?.label ?? '',
    name: address?.name ?? user.fullName,
    phone: address?.phone ?? user.phone ?? '',
    street: address?.street ?? '',
    exteriorNumber: address?.exteriorNumber ?? '',
    interiorNumber: address?.interiorNumber ?? '',
    neighborhood: address?.neighborhood ?? '',
    municipality: address?.municipality ?? '',
    postalCode: address?.postalCode ?? '',
    references: address?.references ?? '',
  };
}

/** An optional field is absent, not empty. */
const optional = (value: string) => (value.trim() === '' ? undefined : value);

/** The error text each invalid field of the address form shows. */
function addressErrors(
  values: AddressValues,
  isDefault: boolean,
  texts: DataTexts
):
  | { ok: true; address: ReturnType<typeof addressUpsertRequestSchema.parse> }
  | { ok: false; errors: Partial<Record<AddressField, string>> } {
  const parsed = addressUpsertRequestSchema.safeParse({
    ...values,
    label: optional(values.label),
    interiorNumber: optional(values.interiorNumber),
    references: optional(values.references),
    stateCode: stateOfPostalCode(values.postalCode) ?? '',
    isDefault: isDefault || undefined,
  });
  if (parsed.success) return { ok: true, address: parsed.data };
  const errors: Partial<Record<AddressField, string>> = {};
  for (const issue of parsed.error.issues) {
    const head = String(issue.path[0] ?? 'postalCode');
    const field = (head === 'stateCode' ? 'postalCode' : head) as AddressField;
    errors[field] =
      field in texts.errors
        ? texts.errors[field as 'name' | 'phone' | 'postalCode']
        : texts.errors.required;
  }
  return { ok: false, errors };
}

/** The form of the name and the phone; the e-mail is shown, never edited. */
function ProfileForm({
  user,
  messages,
  onSaved,
}: Readonly<{
  user: MeResponse;
  messages: Messages['account'];
  onSaved: (note: Note) => void;
}>) {
  const texts = messages.data;
  const t = texts.profile;
  const base = useId();
  const [fullName, setFullName] = useState(user.fullName);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [errors, setErrors] = useState<{ fullName?: string; phone?: string }>(
    {}
  );
  const [busy, setBusy] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = profileUpdateRequestSchema.safeParse({ fullName, phone });
    if (!parsed.success) {
      const next: { fullName?: string; phone?: string } = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] === 'phone' ? 'phone' : 'fullName';
        next[field] = texts.errors[field];
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    const result = await updateProfile(parsed.data);
    setBusy(false);
    onSaved(
      result.ok
        ? { kind: 'ok', text: t.saved }
        : { kind: 'error', text: failureText(texts, result.reason) }
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-label={t.title}
      className="flex max-w-xl flex-col gap-4"
    >
      <h2 className="text-lg font-semibold">{t.title}</h2>
      <p className="text-petroleo/80">{t.intro}</p>
      <dl className="flex flex-col gap-1">
        <dt className="text-sm font-medium">{t.email}</dt>
        <dd className="break-all">{user.email}</dd>
        <dd className="text-sm text-petroleo/80">{t.emailNote}</dd>
      </dl>
      {!user.phone && (
        <p className="font-medium text-red-800">{t.incomplete}</p>
      )}
      <TextField
        id={`${base}-fullName`}
        label={t.fullName}
        {...texts.fields.name}
        exampleLabel={messages.exampleLabel}
        error={errors.fullName}
        input={{
          autoComplete: 'name',
          maxLength: 150,
          value: fullName,
          onChange: (event) => setFullName(event.target.value),
        }}
      />
      <TextField
        id={`${base}-phone`}
        label={t.phone}
        {...texts.fields.phone}
        exampleLabel={messages.exampleLabel}
        error={errors.phone}
        input={{
          type: 'tel',
          autoComplete: 'tel-national',
          inputMode: 'numeric',
          maxLength: 10,
          value: phone,
          onChange: (event) => setPhone(event.target.value),
        }}
      />
      <button
        type="submit"
        disabled={busy}
        className="tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60"
      >
        {busy ? t.saving : t.save}
      </button>
    </form>
  );
}

/** The form of one address, new or being edited or completed. */
function AddressForm({
  address,
  user,
  messages,
  locale,
  onSaved,
  onCancel,
}: Readonly<{
  address: AddressView | undefined;
  user: MeResponse;
  messages: Messages['account'];
  locale: Locale;
  onSaved: (note: Note) => void;
  onCancel: () => void;
}>) {
  const texts = messages.data;
  const t = texts.form;
  const base = useId();
  const [values, setValues] = useState(() => initialValues(address, user));
  const [isDefault, setIsDefault] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<AddressField, string>>>(
    {}
  );
  const [busy, setBusy] = useState(false);
  const state = stateOfPostalCode(values.postalCode);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = addressErrors(values, isDefault, texts);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    const result = address
      ? await updateAddress(address.id, checked.address)
      : await createAddress(checked.address);
    setBusy(false);
    onSaved(
      result.ok
        ? { kind: 'ok', text: texts.addresses.saved }
        : { kind: 'error', text: failureText(texts, result.reason) }
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-label={address ? t.titleEdit : t.titleNew}
      className="flex max-w-xl flex-col gap-4 rounded-lg border border-petroleo/20 p-4"
    >
      <h3 className="text-lg font-semibold">
        {address ? t.titleEdit : t.titleNew}
      </h3>
      {ADDRESS_FIELDS.map((field) => (
        <TextField
          key={field}
          id={`${base}-${field}`}
          label={t[field]}
          {...texts.fields[field]}
          exampleLabel={messages.exampleLabel}
          error={errors[field]}
          input={{
            ...ADDRESS_INPUT[field],
            value: values[field],
            onChange: (event) =>
              setValues({ ...values, [field]: event.target.value }),
          }}
        />
      ))}
      <p>
        <span className="text-sm font-medium">{t.state}: </span>
        {state ? stateName(state, locale) : t.stateUnknown}
      </p>
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(event) => setIsDefault(event.target.checked)}
          className="size-5 accent-petroleo"
        />
        {t.isDefault}
      </label>
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="tap-target rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60"
        >
          {busy ? t.saving : t.save}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="tap-target underline"
        >
          {t.cancel}
        </button>
      </div>
    </form>
  );
}

/** One address of the book, with what can be done with it. */
function AddressCard({
  address,
  texts,
  locale,
  busy,
  confirming,
  onEdit,
  onMakeDefault,
  onAskRemove,
  onRemove,
  onKeep,
}: Readonly<{
  address: AddressView;
  texts: DataTexts;
  locale: Locale;
  busy: boolean;
  confirming: boolean;
  onEdit: () => void;
  onMakeDefault: () => void;
  onAskRemove: () => void;
  onRemove: () => void;
  onKeep: () => void;
}>) {
  const t = texts.addresses;
  const title = address.label ?? t.unlabeled;
  const street = [
    address.street,
    address.exteriorNumber,
    address.interiorNumber,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-petroleo/20 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-semibold">{title}</h3>
        {address.isDefault && (
          <span className="rounded-full bg-ocre/30 px-3 text-sm font-semibold">
            {t.default}
          </span>
        )}
      </div>
      {address.isComplete ? (
        <address className="not-italic">
          {address.name}
          <br />
          {street}
          <br />
          {address.neighborhood}, {address.municipality}
          <br />
          {stateName(address.stateCode, locale)}, {address.postalCode}
          <br />
          {address.phone}
          {address.references && (
            <>
              <br />
              {address.references}
            </>
          )}
        </address>
      ) : (
        <>
          <p>
            {stateName(address.stateCode, locale)}, {address.postalCode}
          </p>
          <p className="font-medium text-red-800">{t.incomplete}</p>
        </>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`${address.isComplete ? t.edit : t.complete}: ${title}`}
          className="tap-target underline"
        >
          {address.isComplete ? t.edit : t.complete}
        </button>
        {!address.isDefault && (
          <button
            type="button"
            disabled={busy}
            onClick={onMakeDefault}
            aria-label={`${t.makeDefault}: ${title}`}
            className="tap-target underline"
          >
            {t.makeDefault}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onAskRemove}
          aria-label={`${t.remove}: ${title}`}
          className="tap-target underline"
        >
          {t.remove}
        </button>
      </div>
      {confirming && (
        <dialog
          open
          aria-labelledby={`confirm-${address.id}`}
          className="static m-0 flex w-full flex-col gap-2 rounded-lg border border-red-800/40 bg-white p-4 text-petroleo"
        >
          <p id={`confirm-${address.id}`} className="font-semibold">
            {t.confirm.title}
          </p>
          <p>{t.confirm.text}</p>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={onRemove}
              className="tap-target rounded-lg bg-red-800 px-5 font-semibold text-white"
            >
              {t.confirm.yes}
            </button>
            <button
              type="button"
              onClick={onKeep}
              className="tap-target underline"
            >
              {t.confirm.no}
            </button>
          </div>
        </dialog>
      )}
    </li>
  );
}

/**
 * «Datos y domicilios» of the account area (FC 051 T1.4, T2.6): the e-mail (the identifier, never
 * editable), the name and the phone, and the book of up to five delivery addresses, with the
 * default one marked. An address that only holds the postal code given at sign-up asks to be
 * completed. Every change tells the header at once, so the postal code next to the search box and
 * the delivery state of the cart follow the default address without reloading. Only the state is
 * ever remembered by the browser: no postal code, no address.
 *
 * @param user - The signed-in account, as `GET /v1/account/me` answers it.
 * @param messages - `account` texts.
 * @param locale - Language of the page (names of the states).
 * @param onChanged - Called after a change that may have touched the account (name, phone).
 */
export function AccountProfileAddresses({
  user,
  messages,
  locale,
  onChanged,
}: Readonly<{
  user: MeResponse;
  messages: Messages['account'];
  locale: Locale;
  onChanged: () => void;
}>) {
  const texts = messages.data;
  const t = texts.addresses;
  const [book, setBook] = useState<Book | null>(null);
  const [note, setNote] = useState<Note>(null);
  // The id of the address being edited, `new` for a new one, or none.
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Reads the book and tells the header and the cart where the default address is. */
  const load = useCallback(async () => {
    const result = await listAddresses();
    if (!result.ok) {
      setNote({ kind: 'error', text: failureText(texts, result.reason) });
      return;
    }
    setBook(result.data);
    const chosen = result.data.items.find((address) => address.isDefault);
    if (chosen) getDestinationStore().setState(chosen.stateCode);
    void syncHeaderUser();
  }, [texts]);

  useEffect(() => {
    void load();
  }, [load]);

  /** What follows a write: its note, the book again and, if the account changed, the area. */
  async function settle(next: Note, closing = true) {
    setNote(next);
    if (next?.kind === 'ok') {
      if (closing) setEditing(null);
      setConfirming(null);
      await load();
      onChanged();
    }
  }

  async function makeDefault(address: AddressView) {
    setBusy(true);
    const result = await updateAddress(address.id, { isDefault: true });
    setBusy(false);
    await settle(
      result.ok
        ? { kind: 'ok', text: t.madeDefault }
        : { kind: 'error', text: failureText(texts, result.reason) },
      false
    );
  }

  async function remove(address: AddressView) {
    setBusy(true);
    const result = await deleteAddress(address.id);
    setBusy(false);
    await settle(
      result.ok
        ? { kind: 'ok', text: t.removed }
        : { kind: 'error', text: failureText(texts, result.reason) },
      false
    );
  }

  const full = book !== null && book.items.length >= book.max;

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {note && (
        <output
          className={`block ${note.kind === 'error' ? 'text-red-800' : ''}`}
        >
          {note.text}
        </output>
      )}
      <ProfileForm
        key={`${user.fullName}|${user.phone ?? ''}`}
        user={user}
        messages={messages}
        onSaved={(next) => void settle(next, false)}
      />
      <section aria-label={t.title} className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t.title}</h2>
        {book === null ? (
          <output className="block">{texts.loading}</output>
        ) : (
          <>
            <p className="text-petroleo/80">
              {fill(t.intro, { max: String(book.max) })}
            </p>
            <p className="text-sm font-medium">
              {fill(t.count, {
                count: String(book.items.length),
                max: String(book.max),
              })}
            </p>
            {book.items.length === 0 && <p>{t.empty}</p>}
            <ul className="flex flex-col gap-4">
              {book.items.map((address) => (
                <AddressCard
                  key={address.id}
                  address={address}
                  texts={texts}
                  locale={locale}
                  busy={busy}
                  confirming={confirming === address.id}
                  onEdit={() => setEditing(address.id)}
                  onMakeDefault={() => void makeDefault(address)}
                  onAskRemove={() => setConfirming(address.id)}
                  onRemove={() => void remove(address)}
                  onKeep={() => setConfirming(null)}
                />
              ))}
            </ul>
            {editing === null && (
              <>
                <button
                  type="button"
                  disabled={full}
                  onClick={() => setEditing('new')}
                  className="tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60"
                >
                  {t.new}
                </button>
                {full && <p>{fill(t.limit, { max: String(book.max) })}</p>}
              </>
            )}
            {editing !== null && (
              <AddressForm
                key={editing}
                address={book.items.find((address) => address.id === editing)}
                user={user}
                messages={messages}
                locale={locale}
                onSaved={(next) => void settle(next)}
                onCancel={() => setEditing(null)}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}
