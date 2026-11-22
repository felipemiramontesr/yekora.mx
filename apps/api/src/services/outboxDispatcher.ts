/**
 * The outbox dispatcher (FC 028 F1, ADR 0013, 277_AN V3): the only module of the API that talks
 * SMTP (scripts/checkPlatformGuards.ts), and no route imports it. It sends what the routes
 * queued in `outbox_events`, never inside a request (T2.4a).
 *
 * Two wake-ups, because LiteSpeed may suspend an idle process and a timer alone could leave a
 * sign-in code waiting (T1.3 S):
 * - `kick()`, from app.ts's `onResponse` hook, right after a route queued mail;
 * - a sweep every minute, and one at start, for retries and anything a suspension left behind.
 *
 * Each run takes at most {@link BATCH} due messages and sends them one by one, {@link GAP_MS}
 * apart, so a burst never exceeds the cadence Hostinger's SMTP accepts. A message is claimed
 * with a conditional UPDATE before it is sent, so two runs (or two processes) never send it
 * twice; a claim left by a crash expires after {@link LEASE_MS}. A failed send waits with
 * capped exponential backoff and is marked FAILED after its `max_retries`.
 *
 * @module
 */
import nodemailer from 'nodemailer';
import { retryDelaySeconds } from '../../../../scripts/lib/outboxValidation';
import type { MailConfig } from '../config';
import { decryptTotpSecret } from './authCrypto';
import type { Db } from './db';
import {
  assertMultipart,
  type EmailContent,
  type MailLocale,
  renderEmail,
  resolveMailLocale,
} from './emailTemplate';
import { emailOf } from './identity';
import type { MailEvent } from './outbox';

/** Where a mail tells the person to write when a change was not theirs (FC 042 Enmienda 3). */
const SUPPORT_EMAIL = 'contacto@yekora.mx';
/** Messages one run sends at most. */
const BATCH = 10;
/** Pause between two messages of a run. */
const GAP_MS = 1000;
/** How long a claimed message stays PROCESSING before a sweep may take it again. */
const LEASE_MS = 5 * 60_000;
/** Interval of the sweep. */
const SWEEP_MS = 60_000;

/** One message as the SMTP transport receives it. */
interface MailMessage {
  to: string;
  subject: string;
  /** Plain-text body, with the same information as the HTML one (FC 065 T2.3). */
  text: string;
  /** HTML body of the brand template. */
  html?: string;
}

/** Sends one message, or throws. */
export type SendMail = (message: MailMessage) => Promise<void>;

/** The dispatcher of one application. */
interface OutboxDispatcher {
  /** Starts a run now, or one more right after the current run. */
  kick(): void;
  /** Resolves when no run is in progress. */
  drain(): Promise<void>;
  /** Starts the sweep and runs once. */
  start(): void;
  /** Stops the sweep. */
  stop(): void;
}

/** A due row of `outbox_events`. */
interface OutboxRow {
  id: number;
  event_type: MailEvent['type'];
  payload: string;
  retry_count: number;
  max_retries: number;
}

/**
 * The SMTP sender of the configured mailbox (implicit TLS on 465, STARTTLS otherwise).
 *
 * @param mail - SMTP account.
 * @returns A {@link SendMail} that sends from `MAIL_FROM`.
 */
export function smtpSender(mail: MailConfig): SendMail {
  const transport = nodemailer.createTransport({
    host: mail.host,
    port: mail.port,
    secure: mail.port === 465,
    auth: { user: mail.user, pass: mail.password },
  });
  return async (message) => {
    await transport.sendMail({ from: mail.from, ...message });
  };
}

/**
 * The reset link of a token (FC 042 T1.1): the account page reads the token from the query and
 * drops it from the address bar at once. One link, in the language of the message (FC 065 T2.2).
 */
function resetLink(siteUrl: string, token: string, locale: MailLocale): string {
  const area = locale === 'en' ? '/en/account/' : '/cuenta/';
  return `${siteUrl}${area}?action=reset-password&token=${token}`;
}

/** The subject and the content of one identity message, in one language (FC 065 T1.1, T2.2). */
interface Copy {
  subject: string;
  content: Omit<EmailContent, 'locale'>;
}

/** The words of the four identity messages, in each language. */
const COPY = {
  SIGN_IN_CODE: {
    'es-MX': (code: string): Copy => ({
      subject: 'Tu código de acceso a YĒKORA',
      content: {
        heading: 'Tu código de acceso',
        paragraphs: [
          'Escribe este código para entrar a tu cuenta. Vence en 5 minutos.',
        ],
        code,
        notice:
          'Si no intentaste entrar, cambia tu contraseña: alguien la conoce.',
      },
    }),
    en: (code: string): Copy => ({
      subject: 'Your YĒKORA sign-in code',
      content: {
        heading: 'Your sign-in code',
        paragraphs: [
          'Enter this code to sign in to your account. It expires in 5 minutes.',
        ],
        code,
        notice:
          'If you did not try to sign in, change your password: someone knows it.',
      },
    }),
  },
  PASSWORD_RESET: {
    'es-MX': (link: string): Copy => ({
      subject: 'Restablece tu contraseña de YĒKORA',
      content: {
        heading: 'Elige una contraseña nueva',
        paragraphs: [
          'Para elegir una contraseña nueva, abre el enlace. Vence en 15 minutos y sirve una sola vez.',
        ],
        button: { label: 'Elegir contraseña nueva', url: link },
        notice:
          'Si no lo pediste, ignora este correo: tu contraseña no cambia.',
      },
    }),
    en: (link: string): Copy => ({
      subject: 'Reset your YĒKORA password',
      content: {
        heading: 'Choose a new password',
        paragraphs: [
          'To choose a new password, open the link. It expires in 15 minutes and works once.',
        ],
        button: { label: 'Choose a new password', url: link },
        notice:
          'If you did not ask for it, ignore this e-mail: your password does not change.',
      },
    }),
  },
  PASSWORD_CHANGED: {
    'es-MX': (): Copy => ({
      subject: 'Cambiaste tu contraseña de YĒKORA',
      content: {
        heading: 'Tu contraseña cambió',
        paragraphs: [
          'Tu contraseña cambió y cerramos todas tus sesiones abiertas.',
        ],
        notice: `Si no fuiste tú, escríbenos de inmediato a ${SUPPORT_EMAIL}.`,
      },
    }),
    en: (): Copy => ({
      subject: 'You changed your YĒKORA password',
      content: {
        heading: 'Your password changed',
        paragraphs: ['Your password changed and we closed every open session.'],
        notice: `If this was not you, write to ${SUPPORT_EMAIL} right away.`,
      },
    }),
  },
  TOTP_ENABLED: {
    'es-MX': (): Copy => ({
      subject: 'Activaste la verificación en dos pasos en YĒKORA',
      content: {
        heading: 'Verificación en dos pasos activada',
        paragraphs: [
          'Tu cuenta ahora pide el código de tu app de autenticación al entrar.',
        ],
        notice: `Si no fuiste tú, escríbenos de inmediato a ${SUPPORT_EMAIL}.`,
      },
    }),
    en: (): Copy => ({
      subject: 'You turned on two-step verification on YĒKORA',
      content: {
        heading: 'Two-step verification is on',
        paragraphs: [
          'Your account now asks for the code of your authenticator app when you sign in.',
        ],
        notice: `If this was not you, write to ${SUPPORT_EMAIL} right away.`,
      },
    }),
  },
} as const;

/**
 * The words of one message in its language. Secrets are decrypted here, in memory, and go only
 * into the body that is about to be sent (FC 065 T2.4).
 */
function copyOf(
  keys: { totpKey: Buffer; siteUrl: string },
  event: MailEvent,
  locale: MailLocale
): Copy {
  switch (event.type) {
    case 'SIGN_IN_CODE': {
      const code = decryptTotpSecret(
        keys.totpKey,
        event.challengeId,
        event.code
      ).toString('utf8');
      return COPY.SIGN_IN_CODE[locale](code);
    }
    case 'PASSWORD_RESET': {
      const token = decryptTotpSecret(
        keys.totpKey,
        event.userId,
        event.token
      ).toString('utf8');
      return COPY.PASSWORD_RESET[locale](
        resetLink(keys.siteUrl, token, locale)
      );
    }
    case 'PASSWORD_CHANGED':
      return COPY.PASSWORD_CHANGED[locale]();
    case 'TOTP_ENABLED':
      return COPY.TOTP_ENABLED[locale]();
  }
}

/**
 * The message of one queued event: both bodies, in one language, addressed to the account's
 * current e-mail.
 */
async function render(
  db: Db,
  keys: { totpKey: Buffer; siteUrl: string },
  row: OutboxRow
): Promise<MailMessage> {
  const event = {
    type: row.event_type,
    ...JSON.parse(row.payload),
  } as MailEvent;
  const to = await emailOf(db, event.userId);
  const locale = resolveMailLocale(event.locale);
  const { subject, content } = copyOf(keys, event, locale);
  const { html, text } = renderEmail({ ...content, locale }, keys.siteUrl);
  assertMultipart(html, text);
  return { to, subject, text, html };
}

/**
 * Builds the dispatcher of one application.
 *
 * @param deps - Database, the key of queued codes and links, the site's address (for reset links),
 *   the sender, clock, logger and, for tests, the pause.
 * @returns The dispatcher; nothing runs until {@link OutboxDispatcher.start} or a kick.
 */
export function createOutboxDispatcher(deps: {
  db: Db;
  totpKey: Buffer;
  siteUrl: string;
  send: SendMail;
  now: () => Date;
  log: { error(details: object, message: string): void };
  wait?: (ms: number) => Promise<void>;
}): OutboxDispatcher {
  const { db } = deps;
  const wait =
    deps.wait ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  let running: Promise<void> | null = null;
  let again = false;
  let timer: NodeJS.Timeout | undefined;

  async function deliver(row: OutboxRow): Promise<void> {
    const now = deps.now();
    const claim: unknown = await db.query(
      "UPDATE outbox_events SET status = 'PROCESSING', next_retry_at = ? WHERE id = ? AND status = 'PENDING'",
      [new Date(now.getTime() + LEASE_MS), row.id]
    );
    // Another run took it first.
    if ((claim as { affectedRows: number }).affectedRows !== 1) return;
    try {
      await deps.send(await render(db, deps, row));
      await db.query(
        "UPDATE outbox_events SET status = 'SENT', sent_at = ?, error_message = NULL WHERE id = ?",
        [now, row.id]
      );
    } catch (error) {
      const attempts = Number(row.retry_count) + 1;
      const reason = error instanceof Error ? error.message : String(error);
      await db.query(
        'UPDATE outbox_events SET status = ?, retry_count = ?, next_retry_at = ?, error_message = ? WHERE id = ?',
        [
          attempts >= Number(row.max_retries) ? 'FAILED' : 'PENDING',
          attempts,
          new Date(now.getTime() + retryDelaySeconds(attempts) * 1000),
          reason.slice(0, 500),
          row.id,
        ]
      );
      deps.log.error({ outboxId: row.id, attempts }, 'outbox send failed');
    }
  }

  /** One run: frees expired claims, then sends the due messages in order. */
  async function runOnce(): Promise<number> {
    const now = deps.now();
    // Housekeeping of migration 005: spent anti-bot challenges are useless once expired.
    await db.query('DELETE FROM auth_challenge_nonces WHERE expires_at < ?', [
      now,
    ]);
    await db.query(
      "UPDATE outbox_events SET status = 'PENDING' WHERE status = 'PROCESSING' AND next_retry_at < ?",
      [now]
    );
    const due = await db.query<OutboxRow>(
      "SELECT id, event_type, payload, retry_count, max_retries FROM outbox_events WHERE status = 'PENDING' AND next_retry_at <= ? ORDER BY id LIMIT ?",
      [now, BATCH]
    );
    await due.reduce(
      (previous, row, index) =>
        previous
          .then(() => (index === 0 ? undefined : wait(GAP_MS)))
          .then(() => deliver(row)),
      Promise.resolve()
    );
    return due.length;
  }

  function kick(): void {
    if (running) {
      again = true;
      return;
    }
    running = runOnce()
      .catch((error: unknown) => {
        deps.log.error({ err: error }, 'outbox run failed');
        return 0;
      })
      .then((sent) => {
        running = null;
        // A full batch may have left more behind; a kick during the run asked for another.
        if (again || sent === BATCH) {
          again = false;
          kick();
        }
      });
  }

  const drain = (): Promise<void> =>
    running ? running.then(drain) : Promise.resolve();

  return {
    kick,
    drain,
    start() {
      timer = setInterval(kick, SWEEP_MS);
      timer.unref();
      kick();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
