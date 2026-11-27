// @vitest-environment jsdom
/**
 * FC 077 F4 evidence: the screens of invoicing. The profile is judged before it is saved; the
 * order page offers the request only while it may be made and the downloads once there is an
 * invoice; the staff's queue uploads, rejects, voids and asks for buyers without an account.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/app/i18n';
import {
  askForBuyer,
  askForInvoice,
  closeRequest,
  listInvoiceQueue,
  readFiscalProfile,
  readInvoiceState,
  saveFiscalProfile,
  uploadInvoiceFiles,
} from '@/lib/api/invoiceClient';
import { AccountFiscalProfile } from './AccountFiscalProfile';
import { AccountInvoicesConsole } from './AccountInvoicesConsole';
import { OrderInvoiceRequest } from './OrderInvoiceRequest';

vi.mock('@/lib/api/invoiceClient', async (original) => ({
  ...(await original<typeof import('@/lib/api/invoiceClient')>()),
  readFiscalProfile: vi.fn(),
  saveFiscalProfile: vi.fn(),
  readInvoiceState: vi.fn(),
  askForInvoice: vi.fn(),
  askForBuyer: vi.fn(),
  listInvoiceQueue: vi.fn(),
  uploadInvoiceFiles: vi.fn(),
  closeRequest: vi.fn(),
}));

const api = {
  profile: vi.mocked(readFiscalProfile),
  save: vi.mocked(saveFiscalProfile),
  state: vi.mocked(readInvoiceState),
  ask: vi.mocked(askForInvoice),
  askFor: vi.mocked(askForBuyer),
  list: vi.mocked(listInvoiceQueue),
  upload: vi.mocked(uploadInvoiceFiles),
  close: vi.mocked(closeRequest),
};

const account = getMessages('es-MX').account;
const fiscal = account.fiscal;
const t = account.invoicing;
const NUMBER = 'YEK-2026-AB12CD34';
const ok = <T,>(data: T) => ({ ok: true as const, data });
const no = (reason: string) => ({ ok: false as const, reason }) as never;
const PROFILE = {
  rfc: 'XAXX010101000',
  legalName: 'LA ROSA',
  taxSystem: '612',
  postalCode: '98612',
  defaultCfdiUse: 'G03',
};

const type = (label: string, value: string, inside = document.body) =>
  fireEvent.change(within(inside).getByLabelText(label), {
    target: { value },
  });
const submit = (name: string) =>
  fireEvent.submit(screen.getByRole('form', { name }));
const click = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name }));

function fillFiscal(inside?: HTMLElement) {
  type(fiscal.fields.rfc.label, 'xaxx010101000', inside);
  type(fiscal.fields.legalName.label, 'la rosa', inside);
  type(fiscal.fields.taxSystem.label, '612', inside);
  type(fiscal.fields.postalCode.label, '98612', inside);
  type(fiscal.fields.cfdiUse.label, 'G01', inside);
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
});
afterEach(cleanup);

describe('«Datos para factura»', () => {
  const show = () =>
    render(
      <AccountFiscalProfile
        texts={fiscal}
        exampleLabel={account.exampleLabel}
      />
    );

  it('starts empty without a profile, judges before saving and says how it went', async () => {
    api.profile.mockResolvedValue(no('FISCAL_PROFILE_NOT_FOUND'));
    show();
    await screen.findByRole('form', { name: fiscal.title });
    submit(fiscal.title);
    expect(screen.getByText(fiscal.errors.INVALID_RFC_REJECT)).toBeTruthy();
    expect(api.save).not.toHaveBeenCalled();
    fillFiscal();
    api.save.mockResolvedValueOnce(no('SERVICE_UNAVAILABLE'));
    submit(fiscal.title);
    expect(
      await screen.findByText(fiscal.errors.SERVICE_UNAVAILABLE)
    ).toBeTruthy();
    api.save.mockResolvedValue(ok({ saved: true as const }));
    submit(fiscal.title);
    expect(await screen.findByText(fiscal.saved)).toBeTruthy();
    expect(api.save).toHaveBeenLastCalledWith({
      ...PROFILE,
      defaultCfdiUse: 'G01',
    });
  });

  it('shows the saved data, and says why it could not be read', async () => {
    api.profile.mockResolvedValue(ok(PROFILE));
    show();
    const rfc = (await screen.findByLabelText(
      fiscal.fields.rfc.label
    )) as HTMLInputElement;
    expect(rfc.value).toBe(PROFILE.rfc);
    cleanup();
    api.profile.mockResolvedValue(no('SOMETHING_NEW'));
    show();
    expect(await screen.findByText(fiscal.errors.unknown)).toBeTruthy();
  });

  it('ignores an answer that arrives after leaving', async () => {
    let answer: (value: never) => void = vi.fn();
    api.profile.mockReturnValue(new Promise((done) => (answer = done)));
    const view = show();
    view.unmount();
    answer(no('offline'));
    await Promise.resolve();
    expect(screen.queryByText(fiscal.errors.offline)).toBeNull();
  });
});

describe('the invoice on the order page', () => {
  const show = (status = 'PAID') =>
    render(
      <OrderInvoiceRequest
        order={{ orderNumber: NUMBER, status: status as 'PAID' }}
        texts={fiscal}
        exampleLabel={account.exampleLabel}
        email="ana@example.test"
      />
    );

  it('asks for the invoice with the saved data filled in, checking the e-mail', async () => {
    api.state.mockResolvedValue(ok({ status: null, reason: null }));
    api.profile.mockResolvedValue(ok(PROFILE));
    show();
    fireEvent.click(await screen.findByRole('button', { name: fiscal.ask }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText(fiscal.fields.rfc.label) as HTMLInputElement)
          .value
      ).toBe(PROFILE.rfc)
    );
    type(fiscal.fields.rfc.label, 'x');
    submit(fiscal.ask);
    expect(screen.getByText(fiscal.errors.INVALID_RFC_REJECT)).toBeTruthy();
    type(fiscal.fields.rfc.label, PROFILE.rfc);
    type(fiscal.fields.email.label, 'no');
    submit(fiscal.ask);
    expect(screen.getByText(fiscal.invalidEmail)).toBeTruthy();
    type(fiscal.fields.email.label, ' ana@example.test ');
    api.ask.mockResolvedValueOnce(no('FISCAL_DEADLINE_EXPIRED_REJECT'));
    submit(fiscal.ask);
    expect(
      await screen.findByText(fiscal.errors.FISCAL_DEADLINE_EXPIRED_REJECT)
    ).toBeTruthy();
    api.ask.mockResolvedValue(ok({ id: 1, status: 'PENDING' as const }));
    submit(fiscal.ask);
    expect(await screen.findByText(fiscal.states.PENDING)).toBeTruthy();
    expect(screen.getByText(fiscal.requested)).toBeTruthy();
    expect(screen.queryByRole('button', { name: fiscal.ask })).toBeNull();
    expect(api.ask).toHaveBeenLastCalledWith(NUMBER, {
      rfc: PROFILE.rfc,
      legalName: PROFILE.legalName,
      taxSystem: '612',
      postalCode: '98612',
      cfdiUse: 'G03',
      emailForInvoice: 'ana@example.test',
    });
  });

  it('offers the downloads once delivered, and a new request after a rejection', async () => {
    api.state.mockResolvedValue(ok({ status: 'COMPLETED', reason: null }));
    show();
    expect(await screen.findByText(fiscal.downloadPdf)).toBeTruthy();
    expect(screen.getByText(fiscal.downloadXml).getAttribute('href')).toContain(
      `/orders/${NUMBER}/invoice/xml`
    );
    cleanup();
    api.state.mockResolvedValue(ok({ status: 'REJECTED', reason: 'El RFC' }));
    api.profile.mockResolvedValue(no('FISCAL_PROFILE_NOT_FOUND'));
    show();
    expect(await screen.findByText('Motivo: El RFC')).toBeTruthy();
    click(fiscal.ask);
    expect(screen.getByRole('form', { name: fiscal.ask })).toBeTruthy();
  });

  it('shows nothing for an unpaid order, when the state cannot be read, or after leaving', async () => {
    api.state.mockResolvedValue(ok({ status: null, reason: null }));
    const unpaid = show('PENDING_PAYMENT');
    await waitFor(() => expect(api.state).toHaveBeenCalled());
    expect(unpaid.container.textContent).toBe('');
    cleanup();
    api.state.mockResolvedValue(no('offline'));
    const failed = show();
    await waitFor(() => expect(api.state).toHaveBeenCalledTimes(2));
    expect(failed.container.textContent).toBe('');
    const left = show();
    left.unmount();
    await Promise.resolve();
  });
});

describe('the queue of the staff', () => {
  const ITEM = {
    id: 7,
    orderNumber: NUMBER,
    channel: 'pos',
    totalMxnCents: 116000,
    invoicableMxnCents: 100000,
    status: 'PENDING' as const,
    rfc: 'XAXX010101000',
    legalName: 'LA ROSA',
    taxSystem: '612',
    postalCode: '98612',
    cfdiUse: 'G03',
    email: 'ana@example.test',
    reason: null as string | null,
    requestedAt: '2026-11-27T18:00:00.000Z',
  };
  const page = (items: unknown[], total = items.length) =>
    ok({ items, total, page: 1, pageSize: 50 }) as never;
  const show = (canUpload = true, canRequest = true) =>
    render(
      <AccountInvoicesConsole
        texts={t}
        fiscal={fiscal}
        exampleLabel={account.exampleLabel}
        locale="es-MX"
        canUpload={canUpload}
        canRequest={canRequest}
      />
    );
  const named = (template: string) => template.replace('{number}', NUMBER);
  const pick = (label: string, file: File) =>
    fireEvent.change(screen.getByLabelText(label), {
      target: { files: [file] },
    });
  const file = (name: string, content: string, size?: number) => {
    const made = new File([content], name);
    Object.defineProperty(made, 'arrayBuffer', {
      value: async () => new TextEncoder().encode(content).buffer,
    });
    if (size !== undefined) {
      Object.defineProperty(made, 'size', { value: size });
    }
    return made;
  };

  it('uploads both files of a waiting request, after checking them', async () => {
    api.list.mockResolvedValue(page([ITEM]));
    show();
    const upload = await screen.findByRole('form', {
      name: named(t.uploadFor),
    });
    expect(screen.getByText('$1,000.00 MXN')).toBeTruthy();
    fireEvent.submit(upload);
    expect(screen.getByText(t.chooseBoth)).toBeTruthy();
    pick(t.fields.pdf.label, file('f.pdf', '%PDF-', 3_000_000));
    pick(t.fields.xml.label, file('f.xml', '<x/>'));
    fireEvent.submit(upload);
    expect(screen.getByText(t.tooLarge)).toBeTruthy();
    pick(t.fields.pdf.label, file('f.pdf', '%PDF-'));
    api.upload.mockResolvedValueOnce(no('INVALID_ISSUER_RFC_REJECT'));
    fireEvent.submit(upload);
    expect(
      await screen.findByText(fiscal.errors.INVALID_ISSUER_RFC_REJECT)
    ).toBeTruthy();
    api.upload.mockResolvedValue(
      ok({ id: 7, status: 'COMPLETED' as const, uuid: 'FOLIO' })
    );
    fireEvent.submit(upload);
    expect(
      await screen.findByText('Factura registrada y enviada. Folio FOLIO.')
    ).toBeTruthy();
    expect(api.upload).toHaveBeenLastCalledWith(7, {
      pdfBase64: btoa('%PDF-'),
      xmlBase64: btoa('<x/>'),
    });
  });

  it('treats a file input emptied again as no file', async () => {
    api.list.mockResolvedValue(page([ITEM]));
    show();
    await screen.findByRole('form', { name: named(t.uploadFor) });
    fireEvent.change(screen.getByLabelText(t.fields.pdf.label), {
      target: { files: [] },
    });
    submit(named(t.uploadFor));
    expect(screen.getByText(t.chooseBoth)).toBeTruthy();
  });

  it('rejects with a reason of at least ten letters', async () => {
    api.list.mockResolvedValue(page([ITEM]));
    show();
    const name = named(t.close.reject.formFor);
    await screen.findByRole('form', { name });
    type(t.fields.reason.label, 'no');
    submit(name);
    expect(screen.getByText(t.shortReason)).toBeTruthy();
    type(t.fields.reason.label, 'El RFC no corresponde');
    api.close.mockResolvedValueOnce(no('INVOICE_REQUEST_NOT_PENDING'));
    submit(name);
    expect(
      await screen.findByText(fiscal.errors.INVOICE_REQUEST_NOT_PENDING)
    ).toBeTruthy();
    api.close.mockResolvedValue(ok({ id: 7, status: 'REJECTED' as const }));
    submit(name);
    expect(await screen.findByText(t.close.reject.done)).toBeTruthy();
    expect(api.close).toHaveBeenLastCalledWith(
      7,
      'reject',
      'El RFC no corresponde'
    );
  });

  it('downloads and voids a delivered one; without the permission it only reads', async () => {
    api.list.mockResolvedValue(
      page([{ ...ITEM, status: 'COMPLETED', reason: 'nota' }])
    );
    show();
    const name = named(t.close.cancel.formFor);
    await screen.findByRole('form', { name });
    expect(screen.getByText(fiscal.downloadPdf).getAttribute('href')).toContain(
      `/admin/invoices/${NUMBER}/download/pdf`
    );
    type(t.fields.reason.label, 'Datos equivocados');
    api.close.mockResolvedValue(ok({ id: 7, status: 'CANCELLED' as const }));
    submit(name);
    expect(await screen.findByText(t.close.cancel.done)).toBeTruthy();
    cleanup();
    api.list.mockResolvedValue(
      page([ITEM, { ...ITEM, id: 8, status: 'COMPLETED' }])
    );
    show(false, false);
    await screen.findByText(fiscal.downloadXml);
    expect(screen.queryByRole('form', { name: named(t.uploadFor) })).toBeNull();
    expect(screen.queryByRole('form', { name })).toBeNull();
    expect(screen.queryByRole('button', { name: t.askForBuyer })).toBeNull();
  });

  it('filters, searches and turns pages', async () => {
    api.list.mockResolvedValue(page([], 0));
    show();
    expect(await screen.findByText(t.empty)).toBeTruthy();
    type(t.fields.search.label, ` ${NUMBER} `);
    submit(t.searchTitle);
    type(t.fields.status.label, '');
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith({
        status: '',
        search: NUMBER,
        page: 1,
      })
    );
    api.list.mockResolvedValue(page([ITEM], 120));
    type(t.fields.status.label, 'PENDING');
    const next = await screen.findByRole('button', { name: t.next });
    fireEvent.click(next);
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 })
      )
    );
    fireEvent.click(screen.getByRole('button', { name: t.previous }));
    await waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1 })
      )
    );
  });

  it('says why the queue cannot be read', async () => {
    api.list.mockResolvedValue(no('SECOND_FACTOR_REQUIRED'));
    show();
    expect(
      await screen.findByText(fiscal.errors.SECOND_FACTOR_REQUIRED)
    ).toBeTruthy();
  });

  it('asks for the invoice of a buyer without an account', async () => {
    api.list.mockResolvedValue(page([]));
    show();
    click(t.askForBuyer);
    const form = screen.getByRole('form', { name: t.askForBuyer });
    submit(t.askForBuyer);
    expect(screen.getByText(fiscal.errors.INVALID_RFC_REJECT)).toBeTruthy();
    fillFiscal(form);
    type(t.fields.orderNumber.label, ` ${NUMBER.toLowerCase()} `);
    type(fiscal.fields.email.label, ' ana@example.test ', form);
    api.askFor.mockResolvedValueOnce(no('ORDER_BELONGS_TO_ACCOUNT_REJECT'));
    submit(t.askForBuyer);
    expect(
      await screen.findByText(fiscal.errors.ORDER_BELONGS_TO_ACCOUNT_REJECT)
    ).toBeTruthy();
    api.askFor.mockResolvedValue(ok({ id: 9, status: 'PENDING' as const }));
    submit(t.askForBuyer);
    expect(await screen.findByText(fiscal.requested)).toBeTruthy();
    expect(api.askFor).toHaveBeenLastCalledWith(
      expect.objectContaining({
        orderNumber: NUMBER,
        emailForInvoice: 'ana@example.test',
        cfdiUse: 'G01',
      })
    );
    expect(screen.queryByRole('form', { name: t.askForBuyer })).toBeNull();
  });
});
