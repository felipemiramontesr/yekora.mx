'use client';

import { type SubmitEvent, useEffect, useId, useState } from 'react';
import { fiscalDataVerdict } from '@/lib/account/fiscalTypes';
import { readFiscalProfile, saveFiscalProfile } from '@/lib/api/invoiceClient';
import {
  BUTTON,
  EMPTY_FISCAL,
  FiscalFields,
  type FiscalForm,
  type FiscalTexts,
  invoiceFailureText,
  normalized,
  type Note,
  NoteLine,
} from './invoiceShared';

/**
 * «Datos para factura» (FC 077 F4): the fiscal data the account saves once, so a later invoice
 * request starts filled in. Judged here with the same gate the API runs.
 *
 * @param texts - `account.fiscal` texts.
 * @param exampleLabel - The word that introduces an example.
 */
export function AccountFiscalProfile({
  texts,
  exampleLabel,
}: Readonly<{ texts: FiscalTexts; exampleLabel: string }>) {
  const base = useId();
  const [form, setForm] = useState<FiscalForm>(EMPTY_FISCAL);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  useEffect(() => {
    let live = true;
    void readFiscalProfile().then((result) => {
      if (!live) return;
      if (result.ok) {
        const { defaultCfdiUse, ...saved } = result.data;
        setForm({ ...saved, cfdiUse: defaultCfdiUse });
      } else if (result.reason !== 'FISCAL_PROFILE_NOT_FOUND') {
        setNote({
          kind: 'error',
          text: invoiceFailureText(texts, result.reason),
        });
      }
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [texts]);

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = normalized(form);
    const verdict = fiscalDataVerdict(values);
    if (verdict !== 'FISCAL_DATA_ACCEPTED') {
      setNote({ kind: 'error', text: texts.errors[verdict] });
      return;
    }
    const { cfdiUse, ...data } = values;
    setBusy(true);
    const result = await saveFiscalProfile({
      ...data,
      defaultCfdiUse: cfdiUse,
    });
    setBusy(false);
    setNote(
      result.ok
        ? { kind: 'ok', text: texts.saved }
        : { kind: 'error', text: invoiceFailureText(texts, result.reason) }
    );
  }

  return (
    <section aria-label={texts.title} className="flex max-w-xl flex-col gap-4">
      <h2 className="text-xl font-semibold">{texts.title}</h2>
      <p className="text-petroleo/80">{texts.intro}</p>
      {!ready && <output className="block">{texts.loading}</output>}
      {ready && (
        <form
          noValidate
          onSubmit={(event) => void save(event)}
          aria-label={texts.title}
          className="flex flex-col gap-4"
        >
          <FiscalFields
            idBase={base}
            texts={texts}
            exampleLabel={exampleLabel}
            form={form}
            onChange={setForm}
          />
          <button type="submit" disabled={busy} className={BUTTON}>
            {texts.save}
          </button>
        </form>
      )}
      <NoteLine note={note} />
    </section>
  );
}
