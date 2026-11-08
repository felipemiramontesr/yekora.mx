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
  { claim = 1, users = true } = {}
) {
  const sql: { text: string; params: readonly unknown[] }[] = [];
  const queue = [...runs];
  const db = {
    async query(text: string, params: readonly unknown[] = []) {
      sql.push({ text, params });
      if (text.startsWith('SELECT id, event_type')) return queue.shift() ?? [];
      if (text.startsWith('SELECT email FROM users'))
        return users ? [{ email: 'ana@example.test' }] : [];
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
type Message = { to: string; subject: string; text: string };

const log = { error: vi.fn() };

function dispatcher(
  db: Db,
  send = vi.fn<(message: Message) => Promise<void>>(async () => undefined)
) {
  const wait = vi.fn(async () => undefined);
  const outbox = createOutboxDispatcher({
    db,
    totpKey: KEY,
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
