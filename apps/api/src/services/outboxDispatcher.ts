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
import { decryptPii } from './checkoutCrypto';
import type { Db } from './db';
import {
  assertMultipart,
  type EmailContent,
  type MailLocale,
  type OrderBlock,
  renderEmail,
  pickMailLocale,
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
  PAYMENTS_MODE_APPROVED: {
    'es-MX': (mode: string): Copy => ({
      subject: 'Aprobaste un cambio de modo de pagos en YĒKORA',
      content: {
        heading: 'Cambio de modo de pagos aprobado',
        paragraphs: [
          `Se aprobó cambiar los pagos a modo «${mode}». El cambio no ocurre solo: hay que actualizar el modo y las llaves en el servidor y volver a desplegar, dentro de las próximas 24 horas.`,
        ],
        notice: `Si nadie de tu equipo lo pidió, revisa la bitácora y cambia las llaves de pago.`,
      },
    }),
    en: (mode: string): Copy => ({
      subject: 'A payments mode change was approved on YĒKORA',
      content: {
        heading: 'Payments mode change approved',
        paragraphs: [
          `A change of the payments to «${mode}» mode was approved. It does not happen by itself: the mode and the keys must be updated on the server and the API redeployed, within the next 24 hours.`,
        ],
        notice: `If nobody on your team asked for it, check the audit log and rotate the payment keys.`,
      },
    }),
  },
  PAYMENTS_PROBE_FAILED: {
    'es-MX': (processor: string): Copy => ({
      subject: 'Un procesador de pagos no respondió',
      content: {
        heading: 'Un procesador de pagos no respondió',
        paragraphs: [
          `La revisión de salud no pudo conectar con ${processor}. Revisa su panel y las llaves configuradas.`,
        ],
        notice:
          'Este aviso se envía como máximo una vez por hora y por procesador.',
      },
    }),
    en: (processor: string): Copy => ({
      subject: 'A payment processor did not answer',
      content: {
        heading: 'A payment processor did not answer',
        paragraphs: [
          `The health check could not reach ${processor}. Check its dashboard and the configured keys.`,
        ],
        notice: 'This notice is sent at most once an hour for each processor.',
      },
    }),
  },
  WEBHOOK_SIGNATURE_ANOMALY: {
    'es-MX': (processor: string): Copy => ({
      subject: 'Avisos de pago con firma inválida',
      content: {
        heading: 'Avisos de pago con firma inválida',
        paragraphs: [
          `En los últimos 10 minutos llegaron 10 o más avisos de ${processor} con una firma que no es válida. Puede ser un secreto de webhook desactualizado o un intento de suplantación.`,
        ],
        notice:
          'Revisa el secreto del webhook en el panel del procesador y en el servidor.',
      },
    }),
    en: (processor: string): Copy => ({
      subject: 'Payment notices with a bad signature',
      content: {
        heading: 'Payment notices with a bad signature',
        paragraphs: [
          `In the last 10 minutes, 10 or more notices from ${processor} arrived with a signature that is not valid. It may be an outdated webhook secret or an attempt to impersonate the processor.`,
        ],
        notice:
          'Check the webhook secret in the dashboard of the processor and on the server.',
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
  event: Exclude<MailEvent, OrderEvent>,
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
    case 'PAYMENTS_MODE_APPROVED':
      return COPY.PAYMENTS_MODE_APPROVED[locale](event.targetMode);
    case 'PAYMENTS_PROBE_FAILED':
      return COPY.PAYMENTS_PROBE_FAILED[locale](event.processor);
    case 'WEBHOOK_SIGNATURE_ANOMALY':
      return COPY.WEBHOOK_SIGNATURE_ANOMALY[locale](event.processor);
  }
}

/** The three order events, which carry an order id instead of an account. */
type OrderEvent = Extract<MailEvent, { orderId: number }>;

/** What the words of an order message are made of. */
interface OrderContext {
  /** The buyer's name. */
  name: string;
  /** Public order number. */
  number: string;
  /** The site's address, for links. */
  site: string;
  /** The carrier, once the order shipped. */
  carrier: string | null;
  /** The tracking number, once the order shipped. */
  trackingNumber: string | null;
  /** The link to follow the parcel, when the carrier gave one and it is http or https. */
  trackingUrl: string | null;
  /** What a return refunded, as an amount with its currency, for the refund message (FC 071). */
  refund: string | null;
}

/** The columns of an order a message needs, as MariaDB returns them. */
interface OrderData {
  order_number: string;
  /** The language of the order, where the buyer bought (FC 067). */
  order_locale: string;
  /** The language its account chose, or null for a guest (FC 067). */
  account_locale: string | null;
  created_at: Date;
  method_es: string;
  method_en: string;
  items_total_mxn_cents: number;
  shipping_total_mxn_cents: number;
  items_tax_mxn_cents: number;
  shipping_tax_mxn_cents: number;
  total_mxn_cents: number;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  customer_name_enc: Buffer;
  customer_email_enc: Buffer;
  shipping_address_enc: Buffer;
}

/** A line of an order as MariaDB returns it. */
interface OrderItemData {
  sku: string;
  quantity: number;
  unit_price_mxn_cents: number;
  line_total_mxn_cents: number;
  name_es: string;
  name_en: string;
}

/** The delivery address as the checkout sealed it. */
interface SealedAddress {
  street: string;
  exteriorNumber: string;
  interiorNumber?: string;
  neighborhood: string;
  municipality: string;
  stateCode: string;
  postalCode: string;
  references?: string;
  /** Set instead of an address when the sale was made at the counter (FC 076). */
  counter?: string;
}

/** The words of the three order messages, in each language. */
const ORDER_COPY = {
  POS_RECEIPT_EMAIL: {
    'es-MX': ({ number, site }: OrderContext): Copy => ({
      subject: `Tu comprobante de compra ${number}`,
      content: {
        heading: 'Gracias por tu compra en la tienda',
        paragraphs: [
          `Este es el comprobante de tu compra ${number}. Consérvalo para cualquier devolución dentro de los 60 días naturales.`,
        ],
        button: { label: 'Ir a YĒKORA', url: `${site}/` },
      },
    }),
    en: ({ number, site }: OrderContext): Copy => ({
      subject: `Your receipt ${number}`,
      content: {
        heading: 'Thank you for shopping at the store',
        paragraphs: [
          `This is the receipt of your purchase ${number}. Keep it for any return within 60 calendar days.`,
        ],
        button: { label: 'Go to YĒKORA', url: `${site}/en/` },
      },
    }),
  },
  ORDER_CONFIRMED: {
    'es-MX': ({ name, number, site }: OrderContext): Copy => ({
      subject: `Confirmamos tu pedido ${number} en YĒKORA`,
      content: {
        heading: 'Gracias por tu compra',
        paragraphs: [
          `Hola ${name}: recibimos tu pago y tu pedido ${number} está confirmado. Este es el resumen.`,
        ],
        button: {
          label: 'Ver mi pedido',
          url: `${site}/cuenta/${number}/`,
        },
        notice: `Si no reconoces esta compra, escríbenos de inmediato a ${SUPPORT_EMAIL}.`,
      },
    }),
    en: ({ name, number, site }: OrderContext): Copy => ({
      subject: `We confirmed your order ${number} at YĒKORA`,
      content: {
        heading: 'Thank you for your purchase',
        paragraphs: [
          `Hello ${name}: we received your payment and your order ${number} is confirmed. Here is the summary.`,
        ],
        button: {
          label: 'View my order',
          url: `${site}/en/account/${number}/`,
        },
        notice: `If you do not recognize this purchase, write to ${SUPPORT_EMAIL} right away.`,
      },
    }),
  },
  ORDER_EXPIRED: {
    'es-MX': ({ name, number, site }: OrderContext): Copy => ({
      subject: `Tu pedido ${number} venció sin pago`,
      content: {
        heading: 'Tu pedido venció',
        paragraphs: [
          `Hola ${name}: no recibimos el pago de tu pedido ${number} a tiempo, así que liberamos los productos que reservamos. No se hizo ningún cargo.`,
        ],
        button: { label: 'Volver a la tienda', url: `${site}/catalogo/` },
      },
    }),
    en: ({ name, number, site }: OrderContext): Copy => ({
      subject: `Your order ${number} expired unpaid`,
      content: {
        heading: 'Your order expired',
        paragraphs: [
          `Hello ${name}: we did not receive the payment for your order ${number} in time, so we released the products we held. You were not charged.`,
        ],
        button: { label: 'Back to the store', url: `${site}/en/catalog/` },
      },
    }),
  },
  ORDER_CANCELLED: {
    'es-MX': ({ name, number, site }: OrderContext): Copy => ({
      subject: `Cancelamos tu pedido ${number}`,
      content: {
        heading: 'Cancelamos tu pedido',
        paragraphs: [
          `Hola ${name}: no pudimos abrir la página de pago de tu pedido ${number}, así que lo cancelamos y liberamos los productos. No se hizo ningún cargo. Puedes intentar tu compra de nuevo.`,
        ],
        button: { label: 'Volver a la tienda', url: `${site}/catalogo/` },
      },
    }),
    en: ({ name, number, site }: OrderContext): Copy => ({
      subject: `We cancelled your order ${number}`,
      content: {
        heading: 'We cancelled your order',
        paragraphs: [
          `Hello ${name}: we could not open the payment page of your order ${number}, so we cancelled it and released the products. You were not charged. You can try your purchase again.`,
        ],
        button: { label: 'Back to the store', url: `${site}/en/catalog/` },
      },
    }),
  },
  ORDER_REFUNDED: {
    'es-MX': ({ name, number, site }: OrderContext): Copy => ({
      subject: `Reembolsamos tu pedido ${number}`,
      content: {
        heading: 'Reembolsamos tu pedido',
        paragraphs: [
          `Hola ${name}: reembolsamos el pago completo de tu pedido ${number}. El dinero regresa a tu método de pago; según tu banco puede tardar unos días en verse reflejado.`,
        ],
        button: {
          label: 'Ver mi pedido',
          url: `${site}/cuenta/${number}/`,
        },
      },
    }),
    en: ({ name, number, site }: OrderContext): Copy => ({
      subject: `We refunded your order ${number}`,
      content: {
        heading: 'We refunded your order',
        paragraphs: [
          `Hello ${name}: we refunded the full payment of your order ${number}. The money goes back to your payment method; depending on your bank it may take a few days to show.`,
        ],
        button: {
          label: 'View my order',
          url: `${site}/en/account/${number}/`,
        },
      },
    }),
  },
  RETURN_REFUNDED: {
    'es-MX': ({ name, number, site, refund }: OrderContext): Copy => ({
      subject: `Reembolsamos tu devolución del pedido ${number}`,
      content: {
        heading: 'Reembolsamos tu devolución',
        paragraphs: [
          `Hola ${name}: reembolsamos ${refund} por la devolución de tu pedido ${number}. El dinero regresa a tu método de pago; según tu banco puede tardar unos días en verse reflejado.`,
        ],
        button: {
          label: 'Ver mi pedido',
          url: `${site}/cuenta/${number}/`,
        },
      },
    }),
    en: ({ name, number, site, refund }: OrderContext): Copy => ({
      subject: `We refunded your return of order ${number}`,
      content: {
        heading: 'We refunded your return',
        paragraphs: [
          `Hello ${name}: we refunded ${refund} for the return of your order ${number}. The money goes back to your payment method; depending on your bank it may take a few days to show.`,
        ],
        button: {
          label: 'View my order',
          url: `${site}/en/account/${number}/`,
        },
      },
    }),
  },
  ORDER_PREPARED: {
    'es-MX': ({ name, number, site }: OrderContext): Copy => ({
      subject: `Estamos preparando tu pedido ${number}`,
      content: {
        heading: 'Estamos preparando tu pedido',
        paragraphs: [
          `Hola ${name}: tu pedido ${number} ya está en preparación. Te avisaremos en cuanto salga.`,
        ],
        button: {
          label: 'Ver mi pedido',
          url: `${site}/cuenta/${number}/`,
        },
      },
    }),
    en: ({ name, number, site }: OrderContext): Copy => ({
      subject: `We are preparing your order ${number}`,
      content: {
        heading: 'We are preparing your order',
        paragraphs: [
          `Hello ${name}: your order ${number} is being prepared. We will let you know as soon as it ships.`,
        ],
        button: {
          label: 'View my order',
          url: `${site}/en/account/${number}/`,
        },
      },
    }),
  },
  ORDER_SHIPPED: {
    'es-MX': ({
      name,
      number,
      site,
      carrier,
      trackingNumber,
      trackingUrl,
    }: OrderContext): Copy => ({
      subject: `Tu pedido ${number} va en camino`,
      content: {
        heading: 'Tu pedido va en camino',
        paragraphs: [
          `Hola ${name}: tu pedido ${number} salió con ${carrier}. Tu guía de rastreo es ${trackingNumber}.`,
        ],
        button: {
          label: 'Rastrear mi envío',
          url: trackingUrl ?? `${site}/cuenta/${number}/`,
        },
      },
    }),
    en: ({
      name,
      number,
      site,
      carrier,
      trackingNumber,
      trackingUrl,
    }: OrderContext): Copy => ({
      subject: `Your order ${number} is on its way`,
      content: {
        heading: 'Your order is on its way',
        paragraphs: [
          `Hello ${name}: your order ${number} shipped with ${carrier}. Your tracking number is ${trackingNumber}.`,
        ],
        button: {
          label: 'Track my shipment',
          url: trackingUrl ?? `${site}/en/account/${number}/`,
        },
      },
    }),
  },
} as const;

/** An amount in MXN with its currency code, like the site shows it. */
function money(cents: number, locale: MailLocale): string {
  const amount = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'MXN',
    currencyDisplay: 'narrowSymbol',
  }).format(cents / 100);
  return `${amount} MXN`;
}

/** The delivery address as the lines a person reads. */
function addressLines(address: SealedAddress, state: string): string[] {
  // A counter sale ships nothing: its sealed copy only names the counter.
  if (address.counter !== undefined) return [address.counter];
  const number = [address.exteriorNumber, address.interiorNumber]
    .filter((part) => part !== undefined && part !== '')
    .join(' int. ');
  return [
    `${address.street} ${number}`,
    address.neighborhood,
    `${address.municipality}, ${state} ${address.postalCode}`,
    ...(address.references ? [address.references] : []),
  ];
}

/**
 * The message of one order event (FC 066): the order is read when the mail is sent, and the
 * buyer's name, e-mail and address are decrypted here, in memory, and only into the message
 * (T2.2). Nothing personal is written back, logged or queued.
 */
async function renderOrder(
  db: Db,
  keys: { piiKey: Buffer | null; siteUrl: string },
  event: OrderEvent
): Promise<MailMessage> {
  if (keys.piiKey === null) throw new Error('CHECKOUT_PII_KEY is not set');
  const [order] = await db.query<OrderData>(
    'SELECT o.order_number, o.locale AS order_locale, u.preferred_locale AS account_locale, o.carrier, o.tracking_number, o.tracking_url, o.created_at, m.name_es AS method_es, m.name_en AS method_en, o.items_total_mxn_cents, o.shipping_total_mxn_cents, o.items_tax_mxn_cents, o.shipping_tax_mxn_cents, o.total_mxn_cents, o.customer_name_enc, o.customer_email_enc, o.shipping_address_enc FROM orders o JOIN payment_methods m ON m.id = o.payment_method_id LEFT JOIN users u ON u.id = o.user_id WHERE o.id = ?',
    [event.orderId]
  );
  if (order === undefined) throw new Error('Order not found');
  const [items, [zone]] = await Promise.all([
    db.query<OrderItemData>(
      'SELECT i.sku, i.quantity, i.unit_price_mxn_cents, i.line_total_mxn_cents, p.name_es, p.name_en FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = ? ORDER BY i.id',
      [event.orderId]
    ),
    db.query<{ name_es: string; name_en: string }>(
      'SELECT z.name_es, z.name_en FROM orders o JOIN shipping_zones z ON z.id = o.shipping_zone_id WHERE o.id = ?',
      [event.orderId]
    ),
  ]);
  // FC 067 T1.1: what the event asked for, then the account's preference, then the guest's order.
  const locale = pickMailLocale(
    event.locale,
    order.account_locale,
    order.order_locale
  );
  const number = order.order_number;
  const name = decryptPii(
    keys.piiKey,
    number,
    'customer_name',
    order.customer_name_enc
  );
  const to = decryptPii(
    keys.piiKey,
    number,
    'customer_email',
    order.customer_email_enc
  );
  const address = JSON.parse(
    decryptPii(
      keys.piiKey,
      number,
      'shipping_address',
      order.shipping_address_enc
    )
  ) as SealedAddress;
  const english = locale === 'en';
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  }).format(order.created_at);
  // The link of a carrier goes into a button only if it is http or https (FC 068 T2.3).
  const trackingUrl =
    order.tracking_url && /^https?:\/\//i.test(order.tracking_url)
      ? order.tracking_url
      : null;
  const { subject, content } = ORDER_COPY[event.type][locale]({
    name,
    number,
    site: keys.siteUrl,
    carrier: order.carrier,
    trackingNumber: order.tracking_number,
    trackingUrl,
    refund:
      event.type === 'RETURN_REFUNDED'
        ? money(event.refundMxnCents, locale)
        : null,
  });
  const block: OrderBlock = {
    number,
    date,
    method: english ? order.method_en : order.method_es,
    lines: items.map((item) => ({
      name: english ? item.name_en : item.name_es,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: money(item.unit_price_mxn_cents, locale),
      lineTotal: money(item.line_total_mxn_cents, locale),
    })),
    itemsTotal: money(order.items_total_mxn_cents, locale),
    shipping: money(order.shipping_total_mxn_cents, locale),
    tax: money(
      Number(order.items_tax_mxn_cents) + Number(order.shipping_tax_mxn_cents),
      locale
    ),
    total: money(order.total_mxn_cents, locale),
    address: addressLines(address, english ? zone.name_en : zone.name_es),
    ...(order.carrier && order.tracking_number
      ? {
          parcel: {
            carrier: order.carrier,
            trackingNumber: order.tracking_number,
          },
        }
      : {}),
  };
  const { html, text } = renderEmail(
    { ...content, locale, order: block },
    keys.siteUrl
  );
  assertMultipart(html, text);
  return { to, subject, text, html };
}

/**
 * The message of one queued event: both bodies, in one language, addressed to the account's
 * current e-mail.
 */
async function render(
  db: Db,
  keys: { totpKey: Buffer; piiKey: Buffer | null; siteUrl: string },
  row: OutboxRow
): Promise<MailMessage> {
  const event = {
    type: row.event_type,
    ...JSON.parse(row.payload),
  } as MailEvent;
  if ('orderId' in event) return renderOrder(db, keys, event);
  const to = await emailOf(db, event.userId);
  // FC 067 T1.1: what the event asked for, then the account's preference.
  const [account] = await db.query<{ preferred_locale: string }>(
    'SELECT preferred_locale FROM users WHERE id = ?',
    [event.userId]
  );
  const locale = pickMailLocale(event.locale, account?.preferred_locale);
  const { subject, content } = copyOf(keys, event, locale);
  const { html, text } = renderEmail({ ...content, locale }, keys.siteUrl);
  assertMultipart(html, text);
  return { to, subject, text, html };
}

/**
 * Builds the dispatcher of one application.
 *
 * @param deps - Database, the key of queued codes and links, the key of the buyer's sealed data,
 *   the site's address (for links),
 *   the sender, clock, logger and, for tests, the pause.
 * @returns The dispatcher; nothing runs until {@link OutboxDispatcher.start} or a kick.
 */
export function createOutboxDispatcher(deps: {
  db: Db;
  totpKey: Buffer;
  /** Key of the buyer's sealed data; null while checkout is not configured (FC 066 T2.2). */
  piiKey: Buffer | null;
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
