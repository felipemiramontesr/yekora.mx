'use client';

import type { Messages } from '@/app/i18n';
import { CFDI_USES, TAX_SYSTEMS } from '@/lib/account/fiscalTypes';
import { type InvoiceFailure, invoiceFileUrl } from '@/lib/api/invoiceClient';
import { Field } from '../ui/Field';
import { TextField } from '../ui/TextField';

/** `account.fiscal` texts: the fields, their catalogs and the refusals of invoicing. */
export type FiscalTexts = Messages['account']['fiscal'];

/** The main button of a step. */
export const BUTTON =
  'tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60';

/** The quiet button next to it. */
export const QUIET =
  'tap-target self-start rounded-lg border border-petroleo/40 px-5 font-semibold';

/** A select or a text area, like the text fields. */
export const CONTROL =
  'min-h-11 rounded-md border border-petroleo/30 bg-white px-3 aria-invalid:border-red-700';

/** What a screen says after an action. */
export type Note = { kind: 'ok' | 'error'; text: string } | null;

/** The note of an action, or nothing. */
export function NoteLine({ note }: Readonly<{ note: Note }>) {
  return note ? (
    <output className={`block ${note.kind === 'error' ? 'text-red-800' : ''}`}>
      {note.text}
    </output>
  ) : null;
}

/**
 * The message of a refusal: each code is named; anything else is generic.
 *
 * @param texts - `account.fiscal` texts.
 * @param reason - The code of the API or of the transport.
 */
export function invoiceFailureText(
  texts: FiscalTexts,
  reason: InvoiceFailure
): string {
  return reason in texts.errors
    ? texts.errors[reason as keyof FiscalTexts['errors']]
    : texts.errors.unknown;
}

/** The five values as they are typed. */
export interface FiscalForm {
  rfc: string;
  legalName: string;
  taxSystem: string;
  postalCode: string;
  cfdiUse: string;
}

/** An empty form, with the most common use already chosen. */
export const EMPTY_FISCAL: FiscalForm = {
  rfc: '',
  legalName: '',
  taxSystem: '',
  postalCode: '',
  cfdiUse: 'G03',
};

/** The values as they are judged and sent: trimmed and in capitals. */
export function normalized(form: FiscalForm): FiscalForm {
  const clean = (value: string) => value.trim().toUpperCase();
  return {
    rfc: clean(form.rfc),
    legalName: clean(form.legalName),
    taxSystem: form.taxSystem,
    postalCode: clean(form.postalCode),
    cfdiUse: form.cfdiUse,
  };
}

/** A select of one SAT catalog, each code with its name. */
function CatalogField({
  id,
  field,
  codes,
  names,
  exampleLabel,
  value,
  onChange,
}: Readonly<{
  id: string;
  field: FiscalTexts['fields']['taxSystem'];
  codes: readonly string[];
  names: Readonly<Record<string, string>>;
  exampleLabel: string;
  value: string;
  onChange: (next: string) => void;
}>) {
  return (
    <Field
      id={id}
      label={field.label}
      description={field.description}
      example={field.example}
      exampleLabel={exampleLabel}
    >
      {(control) => (
        <select
          {...control}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={CONTROL}
        >
          <option value="" />
          {codes.map((code) => (
            <option key={code} value={code}>
              {code} · {names[code]}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/**
 * The five fields of the fiscal data, used by the profile, the buyer's request and the staff's.
 *
 * @param idBase - Prefix of the ids, unique in the page.
 * @param texts - `account.fiscal` texts.
 * @param exampleLabel - The word that introduces an example.
 * @param form - The values.
 * @param onChange - Receives the new values.
 */
export function FiscalFields({
  idBase,
  texts,
  exampleLabel,
  form,
  onChange,
}: Readonly<{
  idBase: string;
  texts: FiscalTexts;
  exampleLabel: string;
  form: FiscalForm;
  onChange: (next: FiscalForm) => void;
}>) {
  const text = (key: 'rfc' | 'legalName' | 'postalCode') => (
    <TextField
      id={`${idBase}-${key}`}
      {...texts.fields[key]}
      exampleLabel={exampleLabel}
      input={{
        autoComplete: 'off',
        ...(key === 'postalCode' ? { inputMode: 'numeric' } : {}),
        value: form[key],
        onChange: (event) => onChange({ ...form, [key]: event.target.value }),
      }}
    />
  );
  return (
    <>
      {text('rfc')}
      {text('legalName')}
      <CatalogField
        id={`${idBase}-taxSystem`}
        field={texts.fields.taxSystem}
        codes={TAX_SYSTEMS}
        names={texts.taxSystems}
        exampleLabel={exampleLabel}
        value={form.taxSystem}
        onChange={(taxSystem) => onChange({ ...form, taxSystem })}
      />
      {text('postalCode')}
      <CatalogField
        id={`${idBase}-cfdiUse`}
        field={texts.fields.cfdiUse}
        codes={CFDI_USES}
        names={texts.cfdiUses}
        exampleLabel={exampleLabel}
        value={form.cfdiUse}
        onChange={(cfdiUse) => onChange({ ...form, cfdiUse })}
      />
    </>
  );
}

/** The two links that download the files of an invoice. */
export function InvoiceFiles({
  orderNumber,
  reader,
  texts,
}: Readonly<{
  orderNumber: string;
  reader: 'buyer' | 'staff';
  texts: FiscalTexts;
}>) {
  return (
    <p className="flex flex-wrap gap-4">
      {(['pdf', 'xml'] as const).map((kind) => (
        <a
          key={kind}
          href={invoiceFileUrl(orderNumber, kind, reader)}
          className="tap-target underline underline-offset-4"
        >
          {kind === 'pdf' ? texts.downloadPdf : texts.downloadXml}
        </a>
      ))}
    </p>
  );
}
