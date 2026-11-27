/**
 * FC 077 F3 evidence: the upload with the 32 rows of T1.3 and its edges, the rejection and the
 * cancellation, and the downloads of the buyer and of the staff (T2.1, T2.3, T2.4).
 *
 * The database is an in-memory table of handlers keyed by the start of each statement, so the real
 * guard, routes, services and XML reader run unchanged.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { tokenHash } from '../services/authCrypto';
import type { Db, Transactional } from '../services/db';

const KEY = Buffer.alloc(32, 7);
const NOW = new Date('2026-11-27T18:00:00Z');
const NUMBER = 'YEK-2026-AB12CD34';
const STORE_RFC = 'YEK010101AB1';
const UUID = '6F1C2A3B-4D5E-4F60-8A9B-0C1D2E3F4A5B';

const BUYER = 'a0000000-0000-4000-8000-000000000003';
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const TOKENS = new Map([
  [tokenHash('b'.repeat(43)), BUYER],
  [tokenHash('w'.repeat(43)), OWNER],
]);
const session = (letter: string) =>
  `__Host-yekora_session=${letter.repeat(43)}`;
const PERMISSIONS: Record<string, string[]> = {
  [BUYER]: ['account:self'],
  [OWNER]: ['account:self', 'invoices:read', 'invoices:upload'],
};

const store = {
  request: null as Record<string, unknown> | null,
  returned: 0,
  knownUuid: false,
  file: null as Record<string, unknown> | null,
  fileParams: [] as unknown[],
  writes: [] as { sql: string; params: readonly unknown[] }[],
  keys: new Map<string, Record<string, unknown>>(),
};

const write = (sql: string) => (params: readonly unknown[]) => {
  store.writes.push({ sql, params });
  return { affectedRows: 1 };
};

const HANDLERS: [string, (params: readonly unknown[]) => unknown][] = [
  [
    'SELECT s.id, s.user_id',
    (p) => {
      const id = TOKENS.get(p[0] as string);
      return id ? [{ id: p[0], user_id: id, email: 'x@example.test' }] : [];
    },
  ],
  [
    'SELECT ur.role_id',
    (p) =>
      PERMISSIONS[p[0] as string].map((permission) => ({
        role_id: p[0] === BUYER ? 'customer' : 'owner',
        permission_id: permission,
      })),
  ],
  ['SELECT is_totp_enabled', () => [{ is_totp_enabled: 1 }]],
  [
    'SELECT route, request_hash',
    (p) => {
      const row = store.keys.get(p[0] as string);
      return row ? [row] : [];
    },
  ],
  [
    'INSERT INTO idempotency_keys',
    (p) => {
      store.keys.set(p[0] as string, {
        route: p[2],
        request_hash: p[3],
        response_status: p[4],
        response_body: p[6],
        expires_at: p[7],
      });
      return [];
    },
  ],
  [
    'SELECT r.order_id, o.order_number, r.status',
    () => (store.request ? [store.request] : []),
  ],
  ['SELECT COALESCE(SUM(refund_mxn_cents)', () => [{ n: store.returned }]],
  [
    'SELECT id FROM order_invoices WHERE uuid',
    () => (store.knownUuid ? [{ id: 1 }] : []),
  ],
  ['INSERT INTO order_invoices', write('invoice')],
  ["UPDATE invoice_requests SET status = 'COMPLETED'", write('completed')],
  ["UPDATE invoice_requests SET status = 'REJECTED'", write('rejected')],
  ["UPDATE invoice_requests SET status = 'CANCELLED'", write('cancelled')],
  ["UPDATE order_invoices SET status = 'CANCELLED'", write('voided')],
  ['INSERT INTO outbox_events', write('mail')],
  ['INSERT INTO audit_log', write('audit')],
  [
    "SELECT IF(? = 'xml'",
    (p) => {
      store.fileParams = [...p];
      return store.file ? [store.file] : [];
    },
  ],
];

const db: Db & Transactional = {
  async query<Row>(text: string, params: readonly unknown[] = []) {
    const handler = HANDLERS.find(([start]) => text.startsWith(start));
    return (handler ? handler[1](params) : []) as Row[];
  },
  ping: async () => undefined,
  transaction(work) {
    return work(this);
  },
  close: async () => undefined,
};

const BASE = {
  DB_HOST: '127.0.0.1',
  DB_USER: 'root',
  DB_NAME: 'yekora_dev',
  AUTH_SECRET: KEY.toString('base64'),
  TOTP_ENCRYPTION_KEY: KEY.toString('base64'),
};
const boot = async (extra: Record<string, string> = {}) => {
  const built = await buildApp({
    config: loadConfig({ ...BASE, ...extra }),
    db,
    rate: async () => null,
    logger: false,
    now: () => NOW,
  });
  await built.ready();
  return built;
};

let app: FastifyInstance;
let noRfc: FastifyInstance;

beforeAll(async () => {
  app = await boot({ YEKORA_FISCAL_RFC: ` ${STORE_RFC.toLowerCase()} ` });
  noRfc = await boot();
}, 30_000);

afterAll(async () => {
  await app.close();
  await noRfc.close();
});

beforeEach(() => {
  store.request = {
    order_id: 7,
    order_number: NUMBER,
    status: 'PENDING',
    rfc: 'XAXX010101000',
    total_mxn_cents: 116000,
  };
  store.returned = 0;
  store.knownUuid = false;
  store.file = null;
  store.writes = [];
  store.keys.clear();
});

const xml = ({
  issuer = STORE_RFC,
  receiver = 'XAXX010101000',
  total = '1160.00',
  uuid = UUID,
} = {}) =>
  `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Total="${total}"><cfdi:Emisor Rfc="${issuer}"/><cfdi:Receptor Rfc="${receiver}"/><cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="${uuid}" FechaTimbrado="2026-11-27T10:15:00"/></cfdi:Complemento></cfdi:Comprobante>`;
const b64 = (text: string) => Buffer.from(text).toString('base64');
const PDF = b64('%PDF-1.7 factura');
const FILES = { xmlBase64: b64(xml()), pdfBase64: PDF };

interface Options {
  who?: string;
  key?: string | null;
  payload?: unknown;
  target?: FastifyInstance;
}

const send = (
  method: 'GET' | 'POST',
  url: string,
  { who = 'w', key = 'k-1', payload, target }: Options = {}
) =>
  (target ?? app).inject({
    method,
    url,
    headers: {
      cookie: session(who),
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...(key === null ? {} : { 'idempotency-key': key }),
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });

const REQUEST = '/v1/admin/invoices/requests/12';
const upload = (options: Options = {}) =>
  send('POST', `${REQUEST}/upload`, { payload: FILES, ...options });
/** What the services wrote, apart from the audit trail the panel adds to every admin request. */
const wrote = () =>
  store.writes.map((entry) => entry.sql).filter((sql) => sql !== 'audit');
/** The actions the services named in the audit trail. */
const audited = () =>
  store.writes
    .filter((entry) => entry.sql === 'audit')
    .map((entry) => String(entry.params[1]))
    .filter((action) => action.startsWith('INVOICE_'));

describe('POST /v1/admin/invoices/requests/:id/upload (FC 077 F3)', () => {
  it('keeps both files, completes the request and queues the delivery with ids only', async () => {
    const answer = await upload();
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toEqual({ id: 12, status: 'COMPLETED', uuid: UUID });
    expect(wrote()).toEqual(['invoice', 'completed', 'mail']);
    expect(audited()).toEqual(['INVOICE_UPLOADED']);
    const kept = store.writes[0].params;
    expect(kept.slice(0, 7)).toEqual([
      12,
      7,
      UUID,
      STORE_RFC,
      'XAXX010101000',
      116000,
      '2026-11-27 10:15:00',
    ]);
    expect(kept[7]).toBe(`${NUMBER}-factura.xml`);
    expect(kept[9]).toMatch(/^[0-9a-f]{64}$/);
    expect(store.writes.find((entry) => entry.sql === 'mail')?.params).toEqual([
      'INVOICE_DELIVERED',
      JSON.stringify({ requestId: 12, orderId: 7 }),
    ]);
    expect((await upload()).headers['idempotency-status']).toBe(
      'IDEMP_REPLAY_SUCCESS'
    );
  });

  const CODES = [
    'INVALID_PDF_FILE_REJECT',
    'INVALID_XML_FILE_REJECT',
    'INVALID_ISSUER_RFC_REJECT',
    'METADATA_MISMATCH_REJECT',
    'INVALID_OR_DUPLICATE_UUID_REJECT',
  ];

  it.each(
    Array.from({ length: 32 }, (_, row) =>
      CODES.map((_code, bit) => (row & (16 >> bit)) === 0)
    )
  )('T1.3 P=%s X=%s E=%s M=%s U=%s', async (p, x, e, m, u) => {
    store.knownUuid = !u;
    const document = xml({
      issuer: e ? STORE_RFC : 'OTR010101AB1',
      total: m ? '1160.00' : '1000.00',
    });
    const answer = await upload({
      payload: {
        pdfBase64: p ? PDF : b64('not a pdf'),
        xmlBase64: b64(x ? document : `<!DOCTYPE x>${document}`),
      },
    });
    const first = [p, x, e, m, u].indexOf(false);
    expect(answer.json().detail).toBe(first === -1 ? undefined : CODES[first]);
    expect(wrote().includes('invoice')).toBe(first === -1);
  });

  it.each([
    [
      'a PDF that is not base64',
      { pdfBase64: '***' },
      'INVALID_PDF_FILE_REJECT',
    ],
    [
      'a PDF over 2 MiB',
      { pdfBase64: b64(`%PDF-${'x'.repeat(2_097_152)}`) },
      'INVALID_PDF_FILE_REJECT',
    ],
    [
      'an XML that is not base64',
      { xmlBase64: 'ab*=' },
      'INVALID_XML_FILE_REJECT',
    ],
    [
      'an XML over 512 KiB',
      { xmlBase64: b64(xml() + ' '.repeat(524_288)) },
      'INVALID_XML_FILE_REJECT',
    ],
    [
      'another receiver',
      { xmlBase64: b64(xml({ receiver: 'OTRO010101000' })) },
      'METADATA_MISMATCH_REJECT',
    ],
    [
      'no folio',
      { xmlBase64: b64(xml({ uuid: 'x' })) },
      'INVALID_OR_DUPLICATE_UUID_REJECT',
    ],
  ])('refuses %s', async (_case, change, code) => {
    const answer = await upload({ payload: { ...FILES, ...change } });
    expect(answer.json().detail).toBe(code);
  });

  it('compares the total with what is left to invoice, to the peso', async () => {
    store.returned = 16000;
    expect((await upload()).json().detail).toBe('METADATA_MISMATCH_REJECT');
    const within = await upload({
      key: 'k-2',
      payload: { ...FILES, xmlBase64: b64(xml({ total: '1001.00' })) },
    });
    expect(within.statusCode).toBe(200);
  });

  it('fails closed without the RFC of the store', async () => {
    const answer = await upload({ target: noRfc });
    expect(answer.statusCode).toBe(500);
    expect(answer.json().detail).toBe('FISCAL_CONFIGURATION_ERROR');
  });

  it('takes only a request that waits, and only from someone who may upload', async () => {
    store.request = { ...store.request, status: 'COMPLETED' };
    expect((await upload()).json().detail).toBe('INVOICE_REQUEST_NOT_PENDING');
    store.request = null;
    expect((await upload({ key: 'k-2' })).statusCode).toBe(404);
    expect((await upload({ who: 'b' })).statusCode).toBe(403);
    expect((await upload({ key: null })).json().detail).toBe(
      'IDEMP_KEY_MISSING'
    );
    expect((await upload({ payload: {} })).statusCode).toBe(400);
  });
});

describe('rejecting and cancelling (FC 077 F3)', () => {
  const reason = { reason: 'El RFC no corresponde' };
  const close = (what: 'reject' | 'cancel', options: Options = {}) =>
    send('POST', `${REQUEST}/${what}`, { payload: reason, ...options });

  it('rejects a waiting request with its reason and the moment', async () => {
    const answer = await close('reject');
    expect(answer.json()).toEqual({ id: 12, status: 'REJECTED' });
    expect(wrote()).toEqual(['rejected']);
    expect(audited()).toEqual(['INVOICE_REJECTED']);
    expect(store.writes[0].params).toEqual([NOW, reason.reason, 12]);
  });

  it('cancels a completed request together with its invoice', async () => {
    store.request = { ...store.request, status: 'COMPLETED' };
    const answer = await close('cancel');
    expect(answer.json()).toEqual({ id: 12, status: 'CANCELLED' });
    expect(wrote()).toEqual(['voided', 'cancelled']);
    expect(audited()).toEqual(['INVOICE_CANCELLED']);
  });

  it('refuses the wrong state, an unknown request, a short reason and a missing key', async () => {
    expect((await close('cancel')).json().detail).toBe(
      'INVOICE_REQUEST_NOT_COMPLETED'
    );
    store.request = { ...store.request, status: 'REJECTED' };
    expect((await close('reject', { key: 'k-2' })).json().detail).toBe(
      'INVOICE_REQUEST_NOT_PENDING'
    );
    store.request = null;
    expect((await close('reject', { key: 'k-3' })).statusCode).toBe(404);
    const short = await close('reject', { payload: { reason: 'no' } });
    expect(short.statusCode).toBe(400);
    expect((await close('reject', { key: null })).statusCode).toBe(400);
    expect(wrote()).toEqual([]);
  });
});

describe('downloading the files (FC 077 T2.1)', () => {
  const FILE = { filename: `${NUMBER}-factura.xml`, data: Buffer.from('<x/>') };

  it.each([
    [
      'the buyer, limited to their orders',
      'b',
      `/v1/account/orders/${NUMBER}/invoice/xml`,
      BUYER,
      'application/xml',
    ],
    [
      'the staff, any order',
      'w',
      `/v1/admin/invoices/${NUMBER}/download/pdf`,
      null,
      'application/pdf',
    ],
  ])(
    'sends the file to %s as an attachment that is never cached, and audits it',
    async (_case, who, url, ownerId, type) => {
      store.file = FILE;
      const answer = await send('GET', url, { who });
      expect(answer.statusCode).toBe(200);
      expect(answer.headers['content-type']).toContain(type);
      expect(answer.headers['content-disposition']).toBe(
        `attachment; filename="${FILE.filename}"`
      );
      expect(answer.headers['cache-control']).toBe('private, no-store');
      expect(answer.headers['x-content-type-options']).toBe('nosniff');
      expect(store.fileParams.slice(3)).toEqual([ownerId, ownerId]);
      expect(audited()).toEqual(['INVOICE_DOWNLOADED']);
    }
  );

  it('answers 404 without an invoice or for a wrong number, and 403 to a buyer on the staff route', async () => {
    const own = `/v1/account/orders/${NUMBER}/invoice/pdf`;
    expect((await send('GET', own, { who: 'b' })).statusCode).toBe(404);
    expect(
      (await send('GET', '/v1/account/orders/x/invoice/xml', { who: 'b' }))
        .statusCode
    ).toBe(404);
    const staff = `/v1/admin/invoices/${NUMBER}/download/xml`;
    expect((await send('GET', staff, { who: 'b' })).statusCode).toBe(403);
    expect(wrote()).toEqual([]);
  });
});
