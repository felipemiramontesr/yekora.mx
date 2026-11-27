/**
 * FC 077 F4 evidence: each call of the invoicing client goes to its route with the session cookie,
 * a write carries its own Idempotency-Key, and a refusal is named by its code.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  askForBuyer,
  askForInvoice,
  closeRequest,
  invoiceFileUrl,
  listInvoiceQueue,
  readFiscalProfile,
  readInvoiceState,
  saveFiscalProfile,
  uploadInvoiceFiles,
} from './invoiceClient';

const answering = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

const sent = (mock: ReturnType<typeof answering>) => {
  const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
  return {
    path: url.replace(/^https?:\/\/[^/]+/, ''),
    method: init.method,
    headers: init.headers as Record<string, string>,
    body: init.body as string | undefined,
  };
};

const DATA = {
  rfc: 'XAXX010101000',
  legalName: 'LA ROSA',
  taxSystem: '612',
  postalCode: '98612',
  cfdiUse: 'G03',
  emailForInvoice: 'ana@example.test',
};
const PROFILE = {
  rfc: 'XAXX010101000',
  legalName: 'LA ROSA',
  taxSystem: '612',
  postalCode: '98612',
  defaultCfdiUse: 'G03',
};
const NUMBER = 'YEK-2026-AB12CD34';
const PAGE = { items: [], total: 0, page: 1, pageSize: 50 };

describe('the invoicing client (FC 077 F4)', () => {
  it.each([
    [
      'reads the profile',
      (f: typeof fetch) => readFiscalProfile(f),
      PROFILE,
      '/v1/account/fiscal-profile',
      'GET',
    ],
    [
      'saves the profile',
      (f: typeof fetch) => saveFiscalProfile(PROFILE, f),
      { saved: true },
      '/v1/account/fiscal-profile',
      'PUT',
    ],
    [
      'reads where a request stands',
      (f: typeof fetch) => readInvoiceState(NUMBER, f),
      { status: null, reason: null },
      `/v1/account/orders/${NUMBER}/invoice-request`,
      'GET',
    ],
    [
      'asks for an invoice',
      (f: typeof fetch) => askForInvoice(NUMBER, DATA, f),
      { id: 1, status: 'PENDING' },
      `/v1/account/orders/${NUMBER}/invoice-request`,
      'POST',
    ],
    [
      'asks for a buyer',
      (f: typeof fetch) => askForBuyer({ ...DATA, orderNumber: NUMBER }, f),
      { id: 1, status: 'PENDING' },
      '/v1/admin/invoices/requests',
      'POST',
    ],
    [
      'lists every request',
      (f: typeof fetch) =>
        listInvoiceQueue({ status: '', search: '', page: 1 }, f),
      PAGE,
      '/v1/admin/invoices/requests?page=1',
      'GET',
    ],
    [
      'lists a filtered page',
      (f: typeof fetch) =>
        listInvoiceQueue({ status: 'PENDING', search: NUMBER, page: 2 }, f),
      PAGE,
      `/v1/admin/invoices/requests?page=2&status=PENDING&search=${NUMBER}`,
      'GET',
    ],
    [
      'uploads the files',
      (f: typeof fetch) =>
        uploadInvoiceFiles(7, { xmlBase64: 'eA==', pdfBase64: 'eA==' }, f),
      { id: 7, status: 'COMPLETED', uuid: 'U' },
      '/v1/admin/invoices/requests/7/upload',
      'POST',
    ],
    [
      'rejects a request',
      (f: typeof fetch) => closeRequest(7, 'reject', 'Un motivo largo', f),
      { id: 7, status: 'REJECTED' },
      '/v1/admin/invoices/requests/7/reject',
      'POST',
    ],
  ])('%s', async (_case, call, answer, path, method) => {
    const fetchImpl = answering(200, answer);
    expect(await call(fetchImpl)).toEqual({ ok: true, data: answer });
    const request = sent(fetchImpl);
    expect(request.path).toBe(path);
    expect(request.method).toBe(method);
    expect('Idempotency-Key' in request.headers).toBe(method !== 'GET');
  });

  it.each([
    [
      409,
      { detail: 'INVOICE_ALREADY_EXISTS_REJECT' },
      'INVOICE_ALREADY_EXISTS_REJECT',
    ],
    [429, {}, 'rate_limited'],
    [500, { detail: 'something else' }, 'unknown'],
  ])('names the refusal of a %i', async (status, body, reason) => {
    expect(await readFiscalProfile(answering(status, body))).toEqual({
      ok: false,
      reason,
    });
  });

  it('uses the global fetch when none is given', async () => {
    const fetchImpl = answering(200, PROFILE);
    vi.stubGlobal('fetch', fetchImpl);
    await readFiscalProfile();
    await saveFiscalProfile(PROFILE);
    await readInvoiceState(NUMBER);
    await askForInvoice(NUMBER, DATA);
    await askForBuyer({ ...DATA, orderNumber: NUMBER });
    await listInvoiceQueue({ status: '', search: '', page: 1 });
    await uploadInvoiceFiles(1, { xmlBase64: 'eA==', pdfBase64: 'eA==' });
    await closeRequest(1, 'cancel', 'Un motivo largo');
    expect(fetchImpl).toHaveBeenCalledTimes(8);
    vi.unstubAllGlobals();
  });

  it('points a download at the route of the buyer or of the staff', () => {
    expect(invoiceFileUrl(NUMBER, 'pdf', 'buyer')).toMatch(
      `/v1/account/orders/${NUMBER}/invoice/pdf`
    );
    expect(invoiceFileUrl(NUMBER, 'xml', 'staff')).toMatch(
      `/v1/admin/invoices/${NUMBER}/download/xml`
    );
  });
});
