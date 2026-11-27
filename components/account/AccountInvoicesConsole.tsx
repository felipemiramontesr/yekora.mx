'use client';

import {
  type SubmitEvent,
  useCallback,
  useEffect,
  useId,
  useState,
} from 'react';
import type { Locale, Messages } from '@/app/i18n';
import { fiscalDataVerdict } from '@/lib/account/fiscalTypes';
import type { InvoiceQueue } from '@/lib/account/invoiceTypes';
import {
  askForBuyer,
  closeRequest,
  type InvoiceFailure,
  listInvoiceQueue,
  uploadInvoiceFiles,
} from '@/lib/api/invoiceClient';
import { fill, formatMoney } from '@/lib/catalog/format';
import { Field } from '../ui/Field';
import { TextField } from '../ui/TextField';
import { when } from './AccountOrders';
import {
  BUTTON,
  CONTROL,
  EMPTY_FISCAL,
  FiscalFields,
  type FiscalForm,
  type FiscalTexts,
  invoiceFailureText,
  InvoiceFiles,
  normalized,
  type Note,
  NoteLine,
  QUIET,
} from './invoiceShared';

/** `account.invoicing` texts. */
export type InvoicingTexts = Messages['account']['invoicing'];

type Queued = InvoiceQueue['items'][number];

/** What both parts of the screen read. */
interface Shared {
  texts: InvoicingTexts;
  fiscal: FiscalTexts;
  exampleLabel: string;
}

const STATUSES = ['PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED'] as const;
const MAX_PDF_BYTES = 2_097_152;
const MAX_XML_BYTES = 524_288;
const PANEL = 'flex flex-col gap-3 rounded-xl border border-petroleo/20 p-5';

/** The bytes of a file in base64. */
async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary);
}

/** A file input of one of the two files of an invoice. */
function FileField({
  id,
  field,
  accept,
  exampleLabel,
  onPick,
}: Readonly<{
  id: string;
  field: InvoicingTexts['fields']['pdf'];
  accept: string;
  exampleLabel: string;
  onPick: (file: File | null) => void;
}>) {
  return (
    <Field id={id} {...field} exampleLabel={exampleLabel}>
      {(control) => (
        <input
          {...control}
          type="file"
          accept={accept}
          onChange={(event) => onPick(event.target.files?.[0] ?? null)}
          className={CONTROL}
        />
      )}
    </Field>
  );
}

/** The upload of the two files of a waiting request. */
function UploadForm({
  item,
  shared,
  onDone,
  onFail,
}: Readonly<{
  item: Queued;
  shared: Shared;
  onDone: (text: string) => void;
  onFail: (reason: InvoiceFailure) => void;
}>) {
  const base = useId();
  const { texts, exampleLabel } = shared;
  const [pdf, setPdf] = useState<File | null>(null);
  const [xml, setXml] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  async function send(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pdf === null || xml === null) {
      setNote({ kind: 'error', text: texts.chooseBoth });
      return;
    }
    if (pdf.size > MAX_PDF_BYTES || xml.size > MAX_XML_BYTES) {
      setNote({ kind: 'error', text: texts.tooLarge });
      return;
    }
    setNote(null);
    setBusy(true);
    const [pdfBase64, xmlBase64] = await Promise.all([
      base64Of(pdf),
      base64Of(xml),
    ]);
    const result = await uploadInvoiceFiles(item.id, { pdfBase64, xmlBase64 });
    setBusy(false);
    if (result.ok) onDone(fill(texts.uploaded, { uuid: result.data.uuid }));
    else onFail(result.reason);
  }

  const name = fill(texts.uploadFor, { number: item.orderNumber });
  return (
    <form
      noValidate
      onSubmit={(event) => void send(event)}
      aria-label={name}
      className="flex flex-col gap-3"
    >
      <FileField
        id={`${base}-pdf`}
        field={texts.fields.pdf}
        accept="application/pdf,.pdf"
        exampleLabel={exampleLabel}
        onPick={setPdf}
      />
      <FileField
        id={`${base}-xml`}
        field={texts.fields.xml}
        accept="application/xml,text/xml,.xml"
        exampleLabel={exampleLabel}
        onPick={setXml}
      />
      <button type="submit" disabled={busy} className={BUTTON}>
        {texts.upload}
      </button>
      <NoteLine note={note} />
    </form>
  );
}

/** The reason to reject a waiting request, or to cancel a completed one. */
function CloseForm({
  item,
  action,
  shared,
  onDone,
  onFail,
}: Readonly<{
  item: Queued;
  action: 'reject' | 'cancel';
  shared: Shared;
  onDone: (text: string) => void;
  onFail: (reason: InvoiceFailure) => void;
}>) {
  const base = useId();
  const { texts, exampleLabel } = shared;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const words = texts.close[action];

  async function send(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reason.trim().length < 10) {
      setNote({ kind: 'error', text: texts.shortReason });
      return;
    }
    setBusy(true);
    const result = await closeRequest(item.id, action, reason.trim());
    setBusy(false);
    if (result.ok) onDone(words.done);
    else onFail(result.reason);
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void send(event)}
      aria-label={fill(words.formFor, { number: item.orderNumber })}
      className="flex flex-col gap-3"
    >
      <TextField
        id={`${base}-reason`}
        {...texts.fields.reason}
        exampleLabel={exampleLabel}
        input={{
          autoComplete: 'off',
          maxLength: 255,
          value: reason,
          onChange: (event) => setReason(event.target.value),
        }}
      />
      <button type="submit" disabled={busy} className={QUIET}>
        {words.button}
      </button>
      <NoteLine note={note} />
    </form>
  );
}

/** One request of the queue with what may be done with it. */
function QueueItem({
  item,
  locale,
  canUpload,
  shared,
  onDone,
  onFail,
}: Readonly<{
  item: Queued;
  locale: Locale;
  canUpload: boolean;
  shared: Shared;
  onDone: (text: string) => void;
  onFail: (reason: InvoiceFailure) => void;
}>) {
  const { texts, fiscal } = shared;
  const money = (cents: number) => formatMoney(cents, 'MXN', locale);
  const facts: [string, string][] = [
    [texts.facts.rfc, item.rfc],
    [texts.facts.legalName, item.legalName],
    [texts.facts.taxSystem, item.taxSystem],
    [texts.facts.postalCode, item.postalCode],
    [texts.facts.cfdiUse, item.cfdiUse],
    [texts.facts.email, item.email],
    [texts.facts.total, money(item.totalMxnCents)],
    [texts.facts.invoicable, money(item.invoicableMxnCents)],
    [texts.facts.requestedAt, when(item.requestedAt, locale)],
  ];
  const actions = { item, shared, onDone, onFail };
  return (
    <li className={PANEL}>
      <h3 className="text-lg font-semibold">
        <span className="font-mono">{item.orderNumber}</span> ·{' '}
        {texts.statuses[item.status]}
      </h3>
      <dl className="grid gap-x-4 text-sm sm:grid-cols-[max-content_1fr]">
        {facts.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-petroleo/80">{term}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {item.reason !== null && (
        <p>{fill(fiscal.reasonLine, { reason: item.reason })}</p>
      )}
      {item.status === 'COMPLETED' && (
        <InvoiceFiles
          orderNumber={item.orderNumber}
          reader="staff"
          texts={fiscal}
        />
      )}
      {canUpload && item.status === 'PENDING' && (
        <>
          <UploadForm {...actions} />
          <CloseForm {...actions} action="reject" />
        </>
      )}
      {canUpload && item.status === 'COMPLETED' && (
        <CloseForm {...actions} action="cancel" />
      )}
    </li>
  );
}

/** The staff asks for the invoice of an order that has no account. */
function StaffRequest({
  shared,
  onDone,
}: Readonly<{ shared: Shared; onDone: (text: string) => void }>) {
  const base = useId();
  const { texts, fiscal, exampleLabel } = shared;
  const [open, setOpen] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');
  const [email, setEmail] = useState('');
  const [form, setForm] = useState<FiscalForm>(EMPTY_FISCAL);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  async function send(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = normalized(form);
    const verdict = fiscalDataVerdict(values);
    if (verdict !== 'FISCAL_DATA_ACCEPTED') {
      setNote({ kind: 'error', text: fiscal.errors[verdict] });
      return;
    }
    setBusy(true);
    const result = await askForBuyer({
      ...values,
      orderNumber: orderNumber.trim().toUpperCase(),
      emailForInvoice: email.trim(),
    });
    setBusy(false);
    if (!result.ok) {
      setNote({
        kind: 'error',
        text: invoiceFailureText(fiscal, result.reason),
      });
      return;
    }
    setOpen(false);
    setNote(null);
    setOrderNumber('');
    setEmail('');
    setForm(EMPTY_FISCAL);
    onDone(fiscal.requested);
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={QUIET}>
        {texts.askForBuyer}
      </button>
    );
  }
  return (
    <form
      noValidate
      onSubmit={(event) => void send(event)}
      aria-label={texts.askForBuyer}
      className={PANEL}
    >
      <p>{texts.askForBuyerIntro}</p>
      <TextField
        id={`${base}-order`}
        {...texts.fields.orderNumber}
        exampleLabel={exampleLabel}
        input={{
          autoComplete: 'off',
          value: orderNumber,
          onChange: (event) => setOrderNumber(event.target.value),
        }}
      />
      <FiscalFields
        idBase={base}
        texts={fiscal}
        exampleLabel={exampleLabel}
        form={form}
        onChange={setForm}
      />
      <TextField
        id={`${base}-email`}
        {...fiscal.fields.email}
        exampleLabel={exampleLabel}
        input={{
          type: 'email',
          autoComplete: 'off',
          value: email,
          onChange: (event) => setEmail(event.target.value),
        }}
      />
      <button type="submit" disabled={busy} className={BUTTON}>
        {fiscal.send}
      </button>
      <NoteLine note={note} />
    </form>
  );
}

/** What loading the queue gave. */
type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; data: InvoiceQueue }
  | { kind: 'failed'; reason: InvoiceFailure };

/**
 * «Facturación» (FC 077 F4): the queue of invoice requests. With `invoices:upload` the files of a
 * waiting one are uploaded, or it is rejected, and a completed one is cancelled; with
 * `invoices:request` the staff asks for an order that has no account.
 *
 * @param texts - `account.invoicing` texts.
 * @param fiscal - `account.fiscal` texts.
 * @param exampleLabel - The word that introduces an example.
 * @param locale - Language of the page.
 * @param canUpload - Whether the account holds `invoices:upload`.
 * @param canRequest - Whether the account holds `invoices:request`.
 */
export function AccountInvoicesConsole({
  texts,
  fiscal,
  exampleLabel,
  locale,
  canUpload,
  canRequest,
}: Readonly<
  Shared & { locale: Locale; canUpload: boolean; canRequest: boolean }
>) {
  const base = useId();
  const [filter, setFilter] = useState({
    status: 'PENDING',
    search: '',
    page: 1,
  });
  const [typed, setTyped] = useState('');
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [note, setNote] = useState<Note>(null);
  const shared = { texts, fiscal, exampleLabel };

  const read = useCallback(async () => {
    const result = await listInvoiceQueue(filter);
    setLoad(
      result.ok
        ? { kind: 'ready', data: result.data }
        : { kind: 'failed', reason: result.reason }
    );
  }, [filter]);

  useEffect(() => {
    void read();
  }, [read]);

  const done = (text: string) => {
    setNote({ kind: 'ok', text });
    void read();
  };
  const fail = (reason: InvoiceFailure) =>
    setNote({ kind: 'error', text: invoiceFailureText(fiscal, reason) });

  function search(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setNote(null);
    setFilter({ ...filter, search: typed.trim(), page: 1 });
  }

  const pages =
    load.kind === 'ready'
      ? Math.max(1, Math.ceil(load.data.total / load.data.pageSize))
      : 1;
  return (
    <section aria-label={texts.title} className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{texts.title}</h2>
      <p className="text-petroleo/80">{texts.intro}</p>
      {canRequest && <StaffRequest shared={shared} onDone={done} />}
      <form
        noValidate
        onSubmit={search}
        aria-label={texts.searchTitle}
        className="flex max-w-xl flex-col gap-3"
      >
        <Field
          id={`${base}-status`}
          {...texts.fields.status}
          exampleLabel={exampleLabel}
        >
          {(control) => (
            <select
              {...control}
              value={filter.status}
              onChange={(event) =>
                setFilter({ ...filter, status: event.target.value, page: 1 })
              }
              className={CONTROL}
            >
              <option value="">{texts.allStatuses}</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {texts.statuses[status]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <TextField
          id={`${base}-search`}
          {...texts.fields.search}
          exampleLabel={exampleLabel}
          input={{
            autoComplete: 'off',
            maxLength: 20,
            value: typed,
            onChange: (event) => setTyped(event.target.value),
          }}
        />
        <button type="submit" className={QUIET}>
          {texts.search}
        </button>
      </form>
      <NoteLine note={note} />
      {load.kind === 'loading' && (
        <output className="block">{fiscal.loading}</output>
      )}
      {load.kind === 'failed' && (
        <p role="alert" className="text-red-800">
          {invoiceFailureText(fiscal, load.reason)}
        </p>
      )}
      {load.kind === 'ready' && load.data.items.length === 0 && (
        <p>{texts.empty}</p>
      )}
      {load.kind === 'ready' && (
        <ul className="flex flex-col gap-4">
          {load.data.items.map((item) => (
            <QueueItem
              key={item.id}
              item={item}
              locale={locale}
              canUpload={canUpload}
              shared={shared}
              onDone={done}
              onFail={fail}
            />
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav
          aria-label={fill(texts.page, { page: filter.page, pages })}
          className="flex items-center gap-4"
        >
          <button
            type="button"
            disabled={filter.page <= 1}
            onClick={() => setFilter({ ...filter, page: filter.page - 1 })}
            className="tap-target underline underline-offset-4 disabled:opacity-50"
          >
            {texts.previous}
          </button>
          <span className="text-sm">
            {fill(texts.page, { page: filter.page, pages })}
          </span>
          <button
            type="button"
            disabled={filter.page >= pages}
            onClick={() => setFilter({ ...filter, page: filter.page + 1 })}
            className="tap-target underline underline-offset-4 disabled:opacity-50"
          >
            {texts.next}
          </button>
        </nav>
      )}
    </section>
  );
}
