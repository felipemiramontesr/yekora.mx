'use client';

import Link from 'next/link';
import {
  type SubmitEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { Messages } from '@/app/i18n';
import type { AddressView } from '@/lib/account/addressTypes';
import { syncHeaderUser } from '@/lib/account/headerSession';
import { listAddresses, updateAddress } from '@/lib/api/accountDataClient';
import { getDestinationStore } from '@/lib/cart/destinationStore';
import { stateOfPostalCode } from '@/lib/cart/postalRanges';
import { rememberDeliveryPlace } from '@/lib/delivery/deliveryPlace';
import { abbreviationOf } from '@/lib/delivery/stateAbbreviations';
import { TextField } from './ui/TextField';

/** `header.delivery` texts. */
type DeliveryTexts = Messages['header']['delivery'];

const BUTTON =
  'tap-target rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60';

/** What loading the saved addresses gave. */
type Book =
  | { kind: 'loading' }
  | { kind: 'ready'; items: AddressView[] }
  | { kind: 'failed' };

/** One line that tells an address apart: its label or street, and where it is. */
function lineOf(address: AddressView): string {
  const name = address.label ?? address.street;
  const place = `${abbreviationOf(address.stateCode)} ${address.postalCode}`;
  return name ? `${name} · ${place}` : place;
}

/** The saved addresses of the account; choosing one makes it the default one. */
function SavedAddresses({
  items,
  texts,
  onChosen,
}: Readonly<{
  items: AddressView[];
  texts: DeliveryTexts;
  onChosen: () => void;
}>) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function choose(address: AddressView) {
    setBusy(address.id);
    setFailed(false);
    const result = await updateAddress(address.id, { isDefault: true });
    if (!result.ok) {
      setBusy(null);
      setFailed(true);
      return;
    }
    // The cart quotes the state of the default address; the header asks for the account again.
    // No postal code of the account is kept in the browser (FC 047 T2.3).
    getDestinationStore().setState(address.stateCode);
    await syncHeaderUser();
    onChosen();
  }

  return (
    <>
      <p className="font-semibold">{texts.saved}</p>
      <ul className="flex flex-col gap-2">
        {items.map((address) => (
          <li key={address.id}>
            <button
              type="button"
              disabled={busy !== null}
              aria-pressed={address.isDefault}
              onClick={() => void choose(address)}
              className="tap-target w-full flex-col items-start rounded-lg border border-petroleo/30 px-4 py-2 text-left aria-pressed:border-petroleo aria-pressed:border-2 disabled:opacity-60"
            >
              <span>{lineOf(address)}</span>
              {address.isDefault && (
                <span className="text-sm text-petroleo/80">
                  {texts.current}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {failed && (
        <p role="alert" className="text-red-800">
          {texts.failedSave}
        </p>
      )}
    </>
  );
}

/** The postal code of whoever has no saved address; it stays in this tab only. */
function PostalCodeForm({
  texts,
  exampleLabel,
  onSaved,
}: Readonly<{
  texts: DeliveryTexts;
  exampleLabel: string;
  onSaved: () => void;
}>) {
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);

  function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const postalCode = code.trim();
    const state = stateOfPostalCode(postalCode);
    if (state === null) {
      setInvalid(true);
      return;
    }
    rememberDeliveryPlace(postalCode);
    getDestinationStore().setState(state);
    onSaved();
  }

  return (
    <form
      noValidate
      onSubmit={save}
      aria-label={texts.codeTitle}
      className="flex flex-col gap-3"
    >
      <TextField
        id="delivery-postal-code"
        label={texts.codeTitle}
        description={texts.codeHint}
        example={texts.codeExample}
        exampleLabel={exampleLabel}
        error={invalid ? texts.invalidCode : undefined}
        input={{
          inputMode: 'numeric',
          autoComplete: 'postal-code',
          maxLength: 5,
          value: code,
          onChange: (event) => {
            setCode(event.target.value);
            setInvalid(false);
          },
        }}
      />
      <button type="submit" className={`${BUTTON} self-start`}>
        {texts.useCode}
      </button>
    </form>
  );
}

/**
 * «Where do we deliver?» (FC 078 T2.6): a native modal dialog, so the rest of the page is inert,
 * Escape closes it and the focus stays inside; a sheet from the bottom on a phone. An account with
 * saved addresses chooses one of them; anyone else types a postal code. It only opens when the
 * person asks for it, and it promises no delivery date.
 *
 * @param texts - `header.delivery` texts.
 * @param exampleLabel - The word that introduces an example.
 * @param signedIn - Whether there is a confirmed account.
 * @param accountHref - Where the delivery addresses are kept.
 * @param onClose - Closes the dialog.
 */
export function DeliveryLocationModal({
  texts,
  exampleLabel,
  signedIn,
  accountHref,
  onClose,
}: Readonly<{
  texts: DeliveryTexts;
  exampleLabel: string;
  signedIn: boolean;
  accountHref: string;
  onClose: () => void;
}>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [book, setBook] = useState<Book>({ kind: 'loading' });

  const load = useCallback(async () => {
    setBook({ kind: 'loading' });
    const result = await listAddresses();
    setBook(
      result.ok
        ? { kind: 'ready', items: result.data.items }
        : { kind: 'failed' }
    );
  }, []);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  const empty = book.kind === 'ready' && book.items.length === 0;
  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="delivery-dialog-title"
      className="mx-auto mb-0 mt-auto w-full max-w-full rounded-t-2xl bg-marfil p-5 text-base font-normal text-petroleo backdrop:bg-petroleo/60 md:my-auto md:max-w-md md:rounded-2xl"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <h2 id="delivery-dialog-title" className="text-xl font-semibold">
            {texts.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="tap-target underline"
          >
            {texts.close}
          </button>
        </div>
        {signedIn && book.kind === 'loading' && (
          <output className="block">{texts.loading}</output>
        )}
        {signedIn && book.kind === 'failed' && (
          <div className="flex flex-col gap-2">
            <p role="alert" className="text-red-800">
              {texts.failedLoad}
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className={`${BUTTON} self-start`}
            >
              {texts.retry}
            </button>
          </div>
        )}
        {signedIn && book.kind === 'ready' && book.items.length > 0 && (
          <SavedAddresses items={book.items} texts={texts} onChosen={onClose} />
        )}
        {(!signedIn || empty) && (
          <PostalCodeForm
            texts={texts}
            exampleLabel={exampleLabel}
            onSaved={onClose}
          />
        )}
        {signedIn && (
          <Link
            href={accountHref}
            onClick={onClose}
            className="tap-target self-start underline underline-offset-4"
          >
            {texts.manage}
          </Link>
        )}
      </div>
    </dialog>
  );
}
