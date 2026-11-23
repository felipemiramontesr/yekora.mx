/**
 * FC 028 F1 evidence of the outbox dispatcher (T1.3 S, ADR 0013): it claims before sending, so
 * a message never leaves twice; it paces a run; a failure waits with capped backoff and ends
 * FAILED after its retries; a full batch or a kick during a run starts another run; the sweep
 * runs at start and on its timer. The SMTP transport is nodemailer, mocked here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { encryptTotpSecret } from './authCrypto';
import { encryptPii } from './checkoutCrypto';
import type { Db, Transactional } from './db';
import { createOutboxDispatcher, smtpSender } from './outboxDispatcher';

const { sendMail, createTransport } = vi.hoisted(() => {
  const send = vi.fn(async () => ({}));
  return {
    sendMail: send,
    createTransport: vi.fn(() => ({ sendMail: send })),
  };
});
vi.mock('nodemailer', () => ({ default: { createTransport } }));

const NOW = new Date('2026-11-03T18:00:00Z');
const KEY = Buffer.alloc(32, 4);
const PII_KEY = Buffer.alloc(32, 9);
const USER = 'u0000000-0000-4000-8000-000000000001';

/** A queued row as the dispatcher selects it. */
const row = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  event_type: 'TOTP_ENABLED',
  payload: JSON.stringify({ userId: USER }),
  retry_count: 0,
  max_retries: 5,
  ...over,
});

/** A database that serves `due` once per run and records every statement. */
function outboxDb(
  runs: ReturnType<typeof row>[][],
  { claim = 1, users = true, locale = 'es-MX' as string | null } = {}
) {
  const sql: { text: string; params: readonly unknown[] }[] = [];
  const queue = [...runs];
  const db = {
    async query(text: string, params: readonly unknown[] = []) {
      sql.push({ text, params });
      if (text.startsWith('SELECT id, event_type')) return queue.shift() ?? [];
      if (text.startsWith('SELECT email FROM users'))
        return users ? [{ email: 'ana@example.test' }] : [];
      if (text.startsWith('SELECT preferred_locale FROM users'))
        return users && locale !== null ? [{ preferred_locale: locale }] : [];
      if (text.startsWith("UPDATE outbox_events SET status = 'PROCESSING'"))
        return { affectedRows: claim };
      return [];
    },
  } as unknown as Db;
  const updates = (start: string) =>
    sql
      .filter(({ text }) => text.startsWith(start))
      .map(({ params }) => params);
  return { db, sql, updates };
}

/** What the recording sender receives. */
type Message = { to: string; subject: string; text: string; html?: string };

const log = { error: vi.fn() };

function dispatcher(
  db: Db,
  send = vi.fn<(message: Message) => Promise<void>>(async () => undefined)
) {
  const wait = vi.fn(async () => undefined);
  const outbox = createOutboxDispatcher({
    db,
    totpKey: KEY,
    piiKey: PII_KEY,
    siteUrl: 'https://yekora.mx',
    send,
    now: () => NOW,
    log,
    wait,
  });
  return { outbox, send, wait };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('outbox dispatcher (FC 028 T1.3 S)', () => {
  it('frees expired claims, claims each due message, sends it and marks it SENT', async () => {
    const challengeId = 'c0000000-0000-4000-8000-000000000009';
    const { db, sql, updates } = outboxDb([
      [
        row(1, {
          event_type: 'SIGN_IN_CODE',
          payload: JSON.stringify({
            userId: USER,
            challengeId,
            code: encryptTotpSecret(KEY, challengeId, Buffer.from('482913')),
          }),
        }),
        row(2),
      ],
    ]);
    const { outbox, send, wait } = dispatcher(db);
    outbox.kick();
    await outbox.drain();
    // Housekeeping first (migration 005), then expired claims go back to the queue.
    expect(sql.slice(0, 2)).toEqual([
      {
        text: 'DELETE FROM auth_challenge_nonces WHERE expires_at < ?',
        params: [NOW],
      },
      {
        text: "UPDATE outbox_events SET status = 'PENDING' WHERE status = 'PROCESSING' AND next_retry_at < ?",
        params: [NOW],
      },
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatchObject({
      to: 'ana@example.test',
      subject: 'Tu código de acceso a YĒKORA',
    });
    expect(send.mock.calls[0][0].text).toContain('482913');
    // Paced: one pause between the two messages, none before the first.
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(1000);
    expect(updates("UPDATE outbox_events SET status = 'PROCESSING'")).toEqual([
      [new Date(NOW.getTime() + 5 * 60_000), 1],
      [new Date(NOW.getTime() + 5 * 60_000), 2],
    ]);
    expect(updates("UPDATE outbox_events SET status = 'SENT'")).toEqual([
      [NOW, 1],
      [NOW, 2],
    ]);
  });

  it('never sends a message another run claimed first', async () => {
    const { db, updates } = outboxDb([[row(1)]], { claim: 0 });
    const { outbox, send } = dispatcher(db);
    outbox.kick();
    await outbox.drain();
    expect(send).not.toHaveBeenCalled();
    expect(updates("UPDATE outbox_events SET status = 'SENT'")).toEqual([]);
  });

  it('retries a failed send with capped backoff, and marks it FAILED after its retries', async () => {
    const { db, updates } = outboxDb([[row(1), row(2, { retry_count: 4 })]]);
    const failing = vi.fn(async () => {
      throw new Error('421 too many messages');
    });
    const { outbox } = dispatcher(db, failing);
    outbox.kick();
    await outbox.drain();
    expect(updates('UPDATE outbox_events SET status = ?')).toEqual([
      [
        'PENDING',
        1,
        new Date(NOW.getTime() + 30_000),
        '421 too many messages',
        1,
      ],
      [
        'FAILED',
        5,
        new Date(NOW.getTime() + 480_000),
        '421 too many messages',
        2,
      ],
    ]);
    expect(log.error).toHaveBeenCalledWith(
      { outboxId: 2, attempts: 5 },
      'outbox send failed'
    );
  });

  it('counts a recipient that no longer exists, or a thrown non-error, as a failed send', async () => {
    const { db, updates } = outboxDb([[row(1)]], { users: false });
    const { outbox } = dispatcher(db);
    outbox.kick();
    await outbox.drain();
    expect(updates('UPDATE outbox_events SET status = ?')[0][0]).toBe(
      'PENDING'
    );
    const second = outboxDb([[row(2)]]);
    const { outbox: other } = dispatcher(
      second.db,
      vi.fn(async () => Promise.reject('socket closed'))
    );
    other.kick();
    await other.drain();
    expect(second.updates('UPDATE outbox_events SET status = ?')[0][3]).toBe(
      'socket closed'
    );
  });

  it('runs again after a full batch, and once more when kicked during a run', async () => {
    const full = Array.from({ length: 10 }, (_, i) => row(i + 1));
    const { db, sql } = outboxDb([full, [], []]);
    const { outbox } = dispatcher(db);
    outbox.kick();
    outbox.kick();
    await outbox.drain();
    const selects = sql.filter(({ text }) => text.startsWith('SELECT id'));
    expect(selects).toHaveLength(2);
    expect(selects[0].params).toEqual([NOW, 10]);
  });

  it('logs a run that fails and keeps the dispatcher usable', async () => {
    const db = {
      query: vi.fn(async () => {
        throw new Error('database gone');
      }),
    } as unknown as Db;
    const { outbox } = dispatcher(db);
    outbox.kick();
    await outbox.drain();
    expect(log.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'outbox run failed'
    );
  });

  it('sweeps at start and every minute until stopped', async () => {
    vi.useFakeTimers();
    const { db, sql } = outboxDb([]);
    const { outbox } = dispatcher(db);
    outbox.start();
    await outbox.drain();
    await vi.advanceTimersByTimeAsync(60_000);
    await outbox.drain();
    outbox.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    const selects = sql.filter(({ text }) => text.startsWith('SELECT id'));
    expect(selects).toHaveLength(2);
  });

  it('waits between messages with a real timer when no pause is injected', async () => {
    vi.useFakeTimers();
    const { db } = outboxDb([[row(1), row(2)]]);
    const send = vi.fn(async () => undefined);
    const outbox = createOutboxDispatcher({
      db,
      totpKey: KEY,
      piiKey: null,
      siteUrl: 'https://yekora.mx',
      send,
      now: () => NOW,
      log,
    });
    outbox.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await outbox.drain();
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('SMTP sender (nodemailer)', () => {
  const mail = {
    host: 'smtp.hostinger.com',
    port: 465,
    user: 'no-reply@yekora.mx',
    password: 'mailbox password',
    from: 'YĒKORA <no-reply@yekora.mx>',
  };

  it('uses implicit TLS on 465 and sends from MAIL_FROM', async () => {
    const send = smtpSender(mail);
    await send({ to: 'ana@example.test', subject: 'S', text: 'T' });
    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.hostinger.com',
      port: 465,
      secure: true,
      auth: { user: 'no-reply@yekora.mx', pass: 'mailbox password' },
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'YĒKORA <no-reply@yekora.mx>',
      to: 'ana@example.test',
      subject: 'S',
      text: 'T',
    });
  });

  it('uses STARTTLS on another port', () => {
    smtpSender({ ...mail, port: 587 });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587, secure: false })
    );
  });

  it('is what the app sends with when no sender is injected, and stops with it', async () => {
    const db: Db & Transactional = {
      query: async <Row>() => [] as Row[],
      ping: async () => undefined,
      transaction(work) {
        return work(this);
      },
      close: async () => undefined,
    };
    const app = await buildApp({
      config: loadConfig({
        DB_HOST: '127.0.0.1',
        DB_USER: 'root',
        DB_NAME: 'yekora_dev',
        AUTH_SECRET: KEY.toString('base64'),
        TOTP_ENCRYPTION_KEY: KEY.toString('base64'),
        SMTP_HOST: 'smtp.hostinger.com',
        SMTP_PORT: '465',
        SMTP_USER: 'no-reply@yekora.mx',
        SMTP_PASSWORD: 'mailbox password',
        MAIL_FROM: 'YĒKORA <no-reply@yekora.mx>',
      }),
      db,
      rate: async () => null,
      logger: false,
    });
    await app.ready();
    await app.close();
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.hostinger.com', secure: true })
    );
  }, 30_000);
});

describe('the branded, single-language mail of the identity events (FC 065 T1.1, T2.2, T2.3, T2.4)', () => {
  const challengeId = 'c0000000-0000-4000-8000-000000000009';
  const events = (locale?: string) => [
    row(1, {
      event_type: 'SIGN_IN_CODE',
      payload: JSON.stringify({
        userId: USER,
        challengeId,
        code: encryptTotpSecret(KEY, challengeId, Buffer.from('482913')),
        locale,
      }),
    }),
    row(2, {
      event_type: 'PASSWORD_RESET',
      payload: JSON.stringify({
        userId: USER,
        token: encryptTotpSecret(KEY, USER, Buffer.from('a'.repeat(64))),
        locale,
      }),
    }),
    row(3, {
      event_type: 'PASSWORD_CHANGED',
      payload: JSON.stringify({ userId: USER, locale }),
    }),
    row(4, {
      event_type: 'TOTP_ENABLED',
      payload: JSON.stringify({ userId: USER, locale }),
    }),
  ];

  async function sentFor(locale?: string) {
    const { db } = outboxDb([events(locale)]);
    const { outbox, send } = dispatcher(db);
    outbox.kick();
    await outbox.drain();
    return send.mock.calls.map(([message]) => message);
  }

  it('hands the transport the text and the HTML of every event, both non-empty, with the same facts (T2.3)', async () => {
    const [code, reset, changed, totp] = await sentFor();
    for (const message of [code, reset, changed, totp]) {
      expect(message.to).toBe('ana@example.test');
      expect(message.subject.length).toBeGreaterThan(0);
      expect(message.text.trim().length).toBeGreaterThan(0);
      expect(message.html?.trim().length).toBeGreaterThan(0);
      expect(message.html).toContain('https://yekora.mx/brand/email/logo.png');
      expect(message.html).toContain('https://yekora.mx/privacidad/');
      expect(message.text).toContain('https://yekora.mx/privacidad/');
      expect(message.html).not.toContain('<script');
    }
    expect(code.text).toContain('482913');
    expect(code.html).toContain('482913');
    const link = `https://yekora.mx/cuenta/?action=reset-password&token=${'a'.repeat(64)}`;
    expect(reset.text).toContain(link);
    expect(reset.html).toContain(link.replace('&', '&amp;'));
    expect(changed.text).toContain('contacto@yekora.mx');
    expect(totp.text).toContain('autenticación');
  });

  it('writes every event without a language in Mexican Spanish only (T1.1)', async () => {
    for (const message of await sentFor()) {
      expect(message.html).toContain('<html lang="es-MX">');
      expect(message.text).not.toMatch(
        /\b(your|expires|right away|sign-in)\b/i
      );
    }
    for (const message of await sentFor('fr')) {
      expect(message.html).toContain('<html lang="es-MX">');
    }
  });

  it('writes an event that asks for English in English only, with the English link and privacy page (T1.1, T2.2)', async () => {
    const [code, reset, changed, totp] = await sentFor('en');
    for (const message of [code, reset, changed, totp]) {
      expect(message.html).toContain('<html lang="en">');
      expect(message.html).toContain('https://yekora.mx/en/privacy/');
      expect(message.text).not.toMatch(/\b(tu|contraseña|vence|cuenta)\b/i);
    }
    expect(code.subject).toBe('Your YĒKORA sign-in code');
    expect(reset.text).toContain(
      `https://yekora.mx/en/account/?action=reset-password&token=${'a'.repeat(64)}`
    );
    expect(reset.text).not.toContain('/cuenta/');
    expect(changed.subject).toBe('You changed your YĒKORA password');
    expect(totp.subject).toBe('You turned on two-step verification on YĒKORA');
  });

  it('keeps the secrets encrypted in the queue and out of the logs: the payload never holds the code or the token (T2.4)', async () => {
    const { db, sql } = outboxDb([events()]);
    const { outbox } = dispatcher(db);
    outbox.kick();
    await outbox.drain();
    const everything =
      JSON.stringify(sql) + JSON.stringify(log.error.mock.calls);
    expect(everything).not.toContain('482913');
    expect(everything).not.toContain('a'.repeat(64));
  });
});

describe('the order mails of the outbox (FC 066 T1.1, T2.2, T2.3, T2.4)', () => {
  const ORDER_NUMBER = 'YEK-2026-AB12CD34';
  const seal = (field: Parameters<typeof encryptPii>[2], value: string) =>
    encryptPii(PII_KEY, ORDER_NUMBER, field, value);
  const ADDRESS = {
    street: 'Av. Barones',
    exteriorNumber: '209',
    interiorNumber: '4B',
    neighborhood: 'Las Américas',
    municipality: 'Guadalupe',
    stateCode: 'ZAC',
    postalCode: '98612',
    references: 'Portón negro',
  };
  const orderRow = (over: Record<string, unknown> = {}) => ({
    order_number: ORDER_NUMBER,
    created_at: new Date('2026-11-21T20:00:00Z'),
    method_es: 'Tarjeta',
    method_en: 'Card',
    items_total_mxn_cents: 185000,
    shipping_total_mxn_cents: 15000,
    items_tax_mxn_cents: 25517,
    shipping_tax_mxn_cents: 2069,
    total_mxn_cents: 200000,
    order_locale: 'es-MX',
    account_locale: null,
    customer_name_enc: seal('customer_name', 'Ana Flores'),
    customer_email_enc: seal('customer_email', 'ana@example.test'),
    shipping_address_enc: seal('shipping_address', JSON.stringify(ADDRESS)),
    ...over,
  });

  /** A database with one order, its lines and its zone; records every statement. */
  function orderDb(
    due: ReturnType<typeof row>[],
    order: ReturnType<typeof orderRow> | null = orderRow(),
    addressOver: Partial<typeof ADDRESS> = {}
  ) {
    const sql: { text: string; params: readonly unknown[] }[] = [];
    const sealed =
      Object.keys(addressOver).length === 0
        ? order
        : order && {
            ...order,
            shipping_address_enc: seal(
              'shipping_address',
              JSON.stringify({ ...ADDRESS, ...addressOver })
            ),
          };
    const runs = [due];
    const db = {
      async query(text: string, params: readonly unknown[] = []) {
        sql.push({ text, params });
        if (text.startsWith('SELECT id, event_type')) return runs.shift() ?? [];
        if (text.startsWith("UPDATE outbox_events SET status = 'PROCESSING'"))
          return { affectedRows: 1 };
        if (text.startsWith('SELECT o.order_number'))
          return sealed ? [sealed] : [];
        if (text.startsWith('SELECT i.sku'))
          return [
            {
              sku: 'TENT',
              quantity: 2,
              unit_price_mxn_cents: 92500,
              line_total_mxn_cents: 185000,
              name_es: 'Tienda 2P',
              name_en: '2P tent',
            },
          ];
        if (text.startsWith('SELECT z.name_es'))
          return [{ name_es: 'Zacatecas', name_en: 'Zacatecas' }];
        return [];
      },
    } as unknown as Db;
    return { db, sql };
  }

  const event = (type: string, locale?: string) =>
    row(1, {
      event_type: type,
      payload: JSON.stringify({ orderId: 7, locale }),
    });

  async function sentFor(due: ReturnType<typeof row>[], made = orderDb(due)) {
    const { outbox, send } = dispatcher(made.db);
    outbox.kick();
    await outbox.drain();
    return { send, ...made };
  }

  const shipped = (over: Record<string, unknown> = {}) =>
    orderRow({
      carrier: 'DHL',
      tracking_number: '1234567890',
      tracking_url: 'https://www.dhl.com/track?id=1234567890',
      ...over,
    });

  it('ORDER_PREPARED tells the buyer the order is being prepared, with a link to it (FC 068 T2.4)', async () => {
    const { send } = await sentFor([event('ORDER_PREPARED')]);
    const [message] = send.mock.calls.map(([sent]) => sent);
    expect(message.subject).toBe(
      `Estamos preparando tu pedido ${ORDER_NUMBER}`
    );
    expect(message.to).toBe('ana@example.test');
    for (const body of [message.text, message.html ?? '']) {
      expect(body).toContain('en preparación');
      expect(body).toContain('TENT');
    }
    expect(message.text).toContain(`https://yekora.mx/cuenta/${ORDER_NUMBER}/`);
    // Nothing has shipped: no carrier and no tracking number.
    expect(message.text).not.toContain('Guía de rastreo');
  });

  it('ORDER_SHIPPED in English without a link points the button to the English order page', async () => {
    const made = orderDb(
      [event('ORDER_SHIPPED', 'en')],
      shipped({ tracking_url: null })
    );
    const { send } = await sentFor([], made);
    const [message] = send.mock.calls.map(([sent]) => sent);
    expect(message.text).toContain(
      `Track my shipment: https://yekora.mx/en/account/${ORDER_NUMBER}/`
    );
  });

  it('ORDER_PREPARED in English, with the English link', async () => {
    const { send } = await sentFor([event('ORDER_PREPARED', 'en')]);
    const [message] = send.mock.calls.map(([sent]) => sent);
    expect(message.subject).toBe(`We are preparing your order ${ORDER_NUMBER}`);
    expect(message.text).toContain('is being prepared');
    expect(message.text).toContain(
      `https://yekora.mx/en/account/${ORDER_NUMBER}/`
    );
    expect(message.text).not.toMatch(/Estamos|pedido/);
  });

  it('ORDER_SHIPPED shows the carrier and the tracking number in both bodies and a button to follow the parcel', async () => {
    const made = orderDb([event('ORDER_SHIPPED')], shipped());
    const { send } = await sentFor([], made);
    const [message] = send.mock.calls.map(([sent]) => sent);
    expect(message.subject).toBe(`Tu pedido ${ORDER_NUMBER} va en camino`);
    for (const body of [message.text, message.html ?? '']) {
      expect(body).toContain('DHL');
      expect(body).toContain('1234567890');
      expect(body).toContain('Transportista');
      expect(body).toContain('Guía de rastreo');
    }
    expect(message.text).toContain(
      'Rastrear mi envío: https://www.dhl.com/track?id=1234567890'
    );
    expect(message.html).toContain(
      'href="https://www.dhl.com/track?id=1234567890"'
    );
  });

  it('ORDER_SHIPPED in English, from the preference of the account (FC 067 and FC 068 T2.4)', async () => {
    const made = orderDb([event('ORDER_SHIPPED', 'en')], shipped());
    const { send } = await sentFor([], made);
    const [message] = send.mock.calls.map(([sent]) => sent);
    expect(message.subject).toBe(`Your order ${ORDER_NUMBER} is on its way`);
    expect(message.text).toContain('Carrier: DHL');
    expect(message.text).toContain('Tracking number: 1234567890');
    expect(message.text).toContain(
      'Track my shipment: https://www.dhl.com/track?id=1234567890'
    );
    expect(message.text).not.toMatch(/Transportista|Guía/);
  });

  it('ORDER_SHIPPED without a usable link points the button to the order, and never to a script (T2.3)', async () => {
    for (const link of [null, 'javascript:alert(1)', 'ftp://x.test/a']) {
      const made = orderDb(
        [event('ORDER_SHIPPED')],
        shipped({ tracking_url: link })
      );
      const { send } = await sentFor([], made);
      const [message] = send.mock.calls.map(([sent]) => sent);
      expect(message.text).toContain(
        `Rastrear mi envío: https://yekora.mx/cuenta/${ORDER_NUMBER}/`
      );
      expect(message.html).not.toContain('javascript:');
      expect(message.html).not.toContain('ftp://');
      vi.clearAllMocks();
    }
  });

  it('sends the confirmation to the buyer’s own address, decrypted in memory, with the whole order in both bodies (T2.2, T2.3)', async () => {
    const { send } = await sentFor([event('ORDER_CONFIRMED')]);
    const [message] = send.mock.calls.map(([sent]) => sent);
    expect(message.to).toBe('ana@example.test');
    expect(message.subject).toBe(
      `Confirmamos tu pedido ${ORDER_NUMBER} en YĒKORA`
    );
    for (const body of [message.text, message.html ?? '']) {
      expect(body).toContain('Hola Ana Flores');
      expect(body).toContain(ORDER_NUMBER);
      expect(body).toContain('Tienda 2P');
      expect(body).toContain('TENT');
      expect(body).toContain('$1,850.00 MXN');
      expect(body).toContain('$150.00 MXN');
      expect(body).toContain('$2,000.00 MXN');
      expect(body).toContain('$275.86 MXN');
      expect(body).toContain('Tarjeta');
      expect(body).toContain('Av. Barones 209 int. 4B');
      expect(body).toContain('Guadalupe, Zacatecas 98612');
      expect(body).toContain('Portón negro');
    }
    expect(message.html).toContain(`https://yekora.mx/cuenta/${ORDER_NUMBER}/`);
    expect(message.text).toContain(`https://yekora.mx/cuenta/${ORDER_NUMBER}/`);
  });

  it('writes the English confirmation in English only, with the English link (T1.1)', async () => {
    const { send } = await sentFor([event('ORDER_CONFIRMED', 'en')]);
    const [message] = send.mock.calls.map(([sent]) => sent);
    expect(message.subject).toBe(
      `We confirmed your order ${ORDER_NUMBER} at YĒKORA`
    );
    expect(message.html).toContain('<html lang="en">');
    expect(message.text).toContain('2P tent');
    expect(message.text).toContain('Payment method: Card');
    expect(message.text).not.toMatch(/\b(Pedido|Tarjeta|Gracias)\b/);
    expect(message.text).toContain(
      `https://yekora.mx/en/account/${ORDER_NUMBER}/`
    );
  });

  it.each([
    [
      'ORDER_EXPIRED',
      undefined,
      `Tu pedido ${ORDER_NUMBER} venció sin pago`,
      'No se hizo ningún cargo',
      'https://yekora.mx/catalogo/',
    ],
    [
      'ORDER_EXPIRED',
      'en',
      `Your order ${ORDER_NUMBER} expired unpaid`,
      'You were not charged',
      'https://yekora.mx/en/catalog/',
    ],
    [
      'ORDER_CANCELLED',
      undefined,
      `Cancelamos tu pedido ${ORDER_NUMBER}`,
      'No se hizo ningún cargo',
      'https://yekora.mx/catalogo/',
    ],
    [
      'ORDER_CANCELLED',
      'en',
      `We cancelled your order ${ORDER_NUMBER}`,
      'You were not charged',
      'https://yekora.mx/en/catalog/',
    ],
  ])(
    'sends the %s notice (%s) with the order and a way back to the store',
    async (type, locale, subject, saying, link) => {
      const { send } = await sentFor([event(type, locale)]);
      const [message] = send.mock.calls.map(([sent]) => sent);
      expect(message.subject).toBe(subject);
      expect(message.text).toContain(saying);
      expect(message.html).toContain(saying);
      expect(message.text).toContain(link);
      expect(message.text).toContain('TENT');
      expect(message.to).toBe('ana@example.test');
    }
  );

  it('leaves out the optional parts of an address (no interior number, no references) and a message holds nothing it was not given', async () => {
    const made = orderDb([event('ORDER_CONFIRMED')], orderRow(), {
      interiorNumber: undefined,
      references: undefined,
    });
    const { send } = await sentFor([], made);
    const [message] = send.mock.calls.map(([sent]) => sent);
    expect(message.text).toContain('Av. Barones 209\n');
    expect(message.text).not.toContain('int.');
    expect(message.text).not.toContain('Portón negro');
  });

  it('keeps the buyer’s data out of the queue, the statements and the logs: only the order id travels (T2.2)', async () => {
    const { sql } = await sentFor([event('ORDER_CONFIRMED')]);
    const everything =
      JSON.stringify(sql) + JSON.stringify(log.error.mock.calls);
    for (const secret of ['Ana Flores', 'ana@example.test', 'Av. Barones']) {
      expect(everything).not.toContain(secret);
    }
    expect(
      sql.find(({ text }) => text.startsWith('SELECT o.order_number'))?.params
    ).toEqual([7]);
  });

  it('retries a message whose order cannot be read or opened, keeping its state (test plan 4)', async () => {
    const missing = await sentFor(
      [event('ORDER_CONFIRMED')],
      orderDb([event('ORDER_CONFIRMED')], null)
    );
    expect(missing.send).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      { outboxId: 1, attempts: 1 },
      'outbox send failed'
    );
    const failed = missing.sql.find(({ text }) =>
      text.startsWith('UPDATE outbox_events SET status = ?')
    );
    expect(failed?.params[0]).toBe('PENDING');
    expect(failed?.params[3]).toBe('Order not found');
  });

  it('retries, and never sends, while the key of the buyer’s data is not configured', async () => {
    const { db, sql } = orderDb([event('ORDER_CONFIRMED')]);
    const send = vi.fn(async () => undefined);
    const outbox = createOutboxDispatcher({
      db,
      totpKey: KEY,
      piiKey: null,
      siteUrl: 'https://yekora.mx',
      send,
      now: () => NOW,
      log,
    });
    outbox.kick();
    await outbox.drain();
    expect(send).not.toHaveBeenCalled();
    expect(
      sql.find(({ text }) =>
        text.startsWith('UPDATE outbox_events SET status = ?')
      )?.params[3]
    ).toBe('CHECKOUT_PII_KEY is not set');
  });
});

describe('the language of every mail: event, account, guest order, es-MX (FC 067 T1.1, T2.1)', () => {
  const challengeId = 'c0000000-0000-4000-8000-000000000009';
  const identity = (type: string, locale?: string) =>
    row(1, {
      event_type: type,
      payload: JSON.stringify({
        userId: USER,
        challengeId,
        code: encryptTotpSecret(KEY, challengeId, Buffer.from('482913')),
        token: encryptTotpSecret(KEY, USER, Buffer.from('a'.repeat(64))),
        locale,
      }),
    });

  async function identityMail(
    type: string,
    account: string,
    explicit?: string
  ) {
    const { db, sql } = outboxDb([[identity(type, explicit)]], {
      locale: account,
    });
    const { outbox, send } = dispatcher(db);
    outbox.kick();
    await outbox.drain();
    return {
      message: send.mock.calls[0][0],
      asked: sql.filter(({ text }) =>
        text.startsWith('SELECT preferred_locale FROM users')
      ),
    };
  }

  it.each([
    [
      'SIGN_IN_CODE',
      'Your YĒKORA sign-in code',
      'Tu código de acceso a YĒKORA',
    ],
    [
      'PASSWORD_RESET',
      'Reset your YĒKORA password',
      'Restablece tu contraseña de YĒKORA',
    ],
    [
      'PASSWORD_CHANGED',
      'You changed your YĒKORA password',
      'Cambiaste tu contraseña de YĒKORA',
    ],
    [
      'TOTP_ENABLED',
      'You turned on two-step verification on YĒKORA',
      'Activaste la verificación en dos pasos en YĒKORA',
    ],
  ])(
    '%s: the preference of the account decides when the event names no language',
    async (type, english, spanish) => {
      const en = await identityMail(type, 'en');
      expect(en.message.subject).toBe(english);
      expect(en.message.html).toContain('<html lang="en">');
      expect(en.asked[0].params).toEqual([USER]);
      const es = await identityMail(type, 'es-MX');
      expect(es.message.subject).toBe(spanish);
    }
  );

  it('an explicit language of the event beats the account, in either direction (X ∧ E, X ∧ ¬E)', async () => {
    expect(
      (await identityMail('TOTP_ENABLED', 'es-MX', 'en')).message.html
    ).toContain('<html lang="en">');
    expect(
      (await identityMail('TOTP_ENABLED', 'en', 'es-MX')).message.html
    ).toContain('<html lang="es-MX">');
  });

  it('a language outside the catalog in the event is skipped, and the account decides', async () => {
    expect(
      (await identityMail('TOTP_ENABLED', 'en', 'fr')).message.html
    ).toContain('<html lang="en">');
  });

  it('writes Mexican Spanish when the account holds no preference at all (T1.1 last row)', async () => {
    const { db } = outboxDb([[identity('TOTP_ENABLED')]], { locale: null });
    const { outbox, send } = dispatcher(db);
    outbox.kick();
    await outbox.drain();
    expect(send.mock.calls[0][0].html).toContain('<html lang="es-MX">');
  });

  it('does not guess a language for an account that is gone: no address, so it is retried', async () => {
    const { db } = outboxDb([[identity('TOTP_ENABLED')]], { users: false });
    const { outbox, send } = dispatcher(db);
    outbox.kick();
    await outbox.drain();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('the language of an order mail (FC 067 T1.1, T2.1)', () => {
  const ORDER_NUMBER = 'YEK-2026-AB12CD34';
  const seal = (field: Parameters<typeof encryptPii>[2], value: string) =>
    encryptPii(PII_KEY, ORDER_NUMBER, field, value);
  const base = {
    order_number: ORDER_NUMBER,
    created_at: new Date('2026-11-21T20:00:00Z'),
    method_es: 'Tarjeta',
    method_en: 'Card',
    items_total_mxn_cents: 185000,
    shipping_total_mxn_cents: 15000,
    items_tax_mxn_cents: 25517,
    shipping_tax_mxn_cents: 2069,
    total_mxn_cents: 200000,
    customer_name_enc: seal('customer_name', 'Ana Flores'),
    customer_email_enc: seal('customer_email', 'ana@example.test'),
    shipping_address_enc: seal(
      'shipping_address',
      JSON.stringify({
        street: 'Av. Barones',
        exteriorNumber: '209',
        neighborhood: 'Las Américas',
        municipality: 'Guadalupe',
        stateCode: 'ZAC',
        postalCode: '98612',
      })
    ),
  };

  async function orderMail(
    order: { order_locale: string; account_locale: string | null },
    explicit?: string
  ) {
    const queued = row(1, {
      event_type: 'ORDER_CONFIRMED',
      payload: JSON.stringify({ orderId: 7, locale: explicit }),
    });
    const db = {
      async query(text: string) {
        if (text.startsWith('SELECT id, event_type')) return [queued];
        if (text.startsWith("UPDATE outbox_events SET status = 'PROCESSING'"))
          return { affectedRows: 1 };
        if (text.startsWith('SELECT o.order_number'))
          return [{ ...base, ...order }];
        if (text.startsWith('SELECT i.sku'))
          return [
            {
              sku: 'TENT',
              quantity: 1,
              unit_price_mxn_cents: 185000,
              line_total_mxn_cents: 185000,
              name_es: 'Tienda',
              name_en: 'Tent',
            },
          ];
        if (text.startsWith('SELECT z.name_es'))
          return [{ name_es: 'Zacatecas', name_en: 'Zacatecas' }];
        return [];
      },
    } as unknown as Db;
    const { outbox, send } = dispatcher(db);
    outbox.kick();
    await outbox.drain();
    return send.mock.calls[0][0];
  }

  it('the account of the buyer decides over the language of the order (account before order)', async () => {
    const english = await orderMail({
      order_locale: 'es-MX',
      account_locale: 'en',
    });
    expect(english.html).toContain('<html lang="en">');
    expect(english.subject).toContain('We confirmed your order');
    const spanish = await orderMail({
      order_locale: 'en',
      account_locale: 'es-MX',
    });
    expect(spanish.html).toContain('<html lang="es-MX">');
  });

  it('a guest has no account: the language of the order decides', async () => {
    const english = await orderMail({
      order_locale: 'en',
      account_locale: null,
    });
    expect(english.html).toContain('<html lang="en">');
    expect(english.text).toContain('Payment method: Card');
    const spanish = await orderMail({
      order_locale: 'es-MX',
      account_locale: null,
    });
    expect(spanish.html).toContain('<html lang="es-MX">');
  });

  it('an explicit language of the event beats both (es-MX stays Spanish for an English account)', async () => {
    const spanish = await orderMail(
      { order_locale: 'en', account_locale: 'en' },
      'es-MX'
    );
    expect(spanish.html).toContain('<html lang="es-MX">');
    const english = await orderMail(
      { order_locale: 'es-MX', account_locale: 'es-MX' },
      'en'
    );
    expect(english.html).toContain('<html lang="en">');
  });

  it('a value in the order outside the catalog never reaches the message: Mexican Spanish', async () => {
    const message = await orderMail({
      order_locale: 'xx',
      account_locale: null,
    });
    expect(message.html).toContain('<html lang="es-MX">');
  });
});
