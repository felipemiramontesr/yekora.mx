/**
 * The branded e-mail template (FC 065 F0, K-89): one place that turns the content of a store
 * message into the two bodies every message carries, an HTML one and a plain-text one with the
 * same information (T2.3), in one language only (T1.1, T2.2).
 *
 * The HTML is built for the demanding clients (Gmail, Outlook, Apple Mail): nested tables, every
 * style inline, a logo with its size and alternative text, no script and no external stylesheet
 * (T2.1). It uses the palette of `tailwind.config.js`: petróleo `#213C41`, marfil `#F8F5EE` and
 * ocre `#AD843E` (ocre only as a line, never as text on white, where it would fail contrast).
 * Every value that reaches the HTML is escaped, so no content can add markup or a header.
 *
 * The module is pure: no network, no database and no secret of its own. The caller hands it the
 * already-decrypted code or link, which lives in memory only until the message is sent (T2.4).
 *
 * @module
 */

/** The languages of the store's mail. */
export type MailLocale = 'es-MX' | 'en';

/** One line of an order, with its amounts already formatted for the reader. */
interface OrderLine {
  /** Product name, in the language of the message. */
  name: string;
  /** Stock-keeping unit. */
  sku: string;
  /** Units bought. */
  quantity: number;
  /** Price of one unit, VAT included. */
  unitPrice: string;
  /** Amount of the line, VAT included. */
  lineTotal: string;
}

/**
 * An order as the message shows it (FC 066 T2.3): who it is, what was bought, what it cost and
 * where it goes. Every amount and the date arrive formatted, so the template stays pure.
 */
export interface OrderBlock {
  /** Public order number. */
  number: string;
  /** When the order was placed. */
  date: string;
  /** How the buyer chose to pay. */
  method: string;
  /** The lines of the order. */
  lines: readonly OrderLine[];
  /** Products, VAT included. */
  itemsTotal: string;
  /** Shipping, VAT included. */
  shipping: string;
  /** VAT contained in the total. */
  tax: string;
  /** Everything the buyer pays. */
  total: string;
  /** The delivery address, one line each. */
  address: readonly string[];
  /** Who carries the parcel and under which tracking number, once it ships (FC 068). */
  parcel?: { carrier: string; trackingNumber: string };
}

/** What one message says, before it is laid out. */
export interface EmailContent {
  /** Language of the whole message. */
  locale: MailLocale;
  /** The title of the message. */
  heading: string;
  /** Paragraphs, in order, shown before the code and the button. */
  paragraphs: readonly string[];
  /** The order the message is about, shown as a summary, a table of lines and the totals. */
  order?: OrderBlock;
  /** A short code shown highlighted and monospaced (a sign-in code). */
  code?: string;
  /** The main action: a labelled link, shown as a button and repeated as plain text. */
  button?: { label: string; url: string };
  /** A security notice shown apart, with an ocre line. */
  notice?: string;
}

/** The two bodies of one message. */
interface RenderedEmail {
  /** The HTML body. */
  html: string;
  /** The plain-text body, with the same information. */
  text: string;
}

/** Palette of the site (`tailwind.config.js`). */
const PETROLEO = '#213C41';
const MARFIL = '#F8F5EE';
const OCRE = '#AD843E';

/** Where the person writes when something is not theirs (FC 042 Enmienda 3). */
const SUPPORT_EMAIL = 'contacto@yekora.mx';

/** Fonts every client has. */
const SANS = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Consolas,'Courier New',monospace";

/** The fixed words of the frame, in each language. */
const FRAME = {
  'es-MX': {
    fallbackLink: 'Si el botón no funciona, copia este enlace en tu navegador:',
    contact: 'Escríbenos a',
    privacy: 'Aviso de privacidad',
    privacyPath: '/privacidad/',
    unattended:
      'Este mensaje se generó de forma automática; no respondas a este correo.',
    order: {
      number: 'Pedido',
      date: 'Fecha',
      method: 'Método de pago',
      carrier: 'Transportista',
      tracking: 'Guía de rastreo',
      product: 'Producto',
      quantity: 'Cant.',
      unit: 'Precio',
      amount: 'Importe',
      items: 'Productos (IVA incluido)',
      shipping: 'Envío (IVA incluido)',
      tax: 'IVA incluido en el total',
      total: 'Total pagado',
      address: 'Dirección de entrega',
    },
  },
  en: {
    fallbackLink:
      'If the button does not work, copy this link into your browser:',
    contact: 'Write to us at',
    privacy: 'Privacy notice',
    privacyPath: '/en/privacy/',
    unattended: 'This message was generated automatically; do not reply to it.',
    order: {
      number: 'Order',
      date: 'Date',
      method: 'Payment method',
      carrier: 'Carrier',
      tracking: 'Tracking number',
      product: 'Product',
      quantity: 'Qty',
      unit: 'Price',
      amount: 'Amount',
      items: 'Products (VAT included)',
      shipping: 'Shipping (VAT included)',
      tax: 'VAT included in the total',
      total: 'Total paid',
      address: 'Delivery address',
    },
  },
} as const;

/**
 * The language a message is written in (FC 067 T1.1): the first of the candidates, in order, that
 * is one of the two official languages; Mexican Spanish when none is. The dispatcher lists them
 * from the strongest to the weakest: what the event itself asked for, the account's preference,
 * the language of a guest's order. A language outside the catalog is skipped, never used, so a
 * message is written in one language only.
 *
 * @param candidates - Languages in order of precedence; absent or unsupported ones are skipped.
 * @returns `en` or `es-MX`.
 */
export function pickMailLocale(
  ...candidates: readonly (string | null | undefined)[]
): MailLocale {
  const found = candidates.find((value) => value === 'es-MX' || value === 'en');
  return found === 'en' ? 'en' : 'es-MX';
}

/**
 * The gate of the multipart delivery (T1.2): a message goes to the transport only with both
 * bodies present, so no client, filter or screen reader gets a half message.
 *
 * @param html - The HTML body.
 * @param text - The plain-text body.
 * @throws When either body is empty.
 */
export function assertMultipart(html: string, text: string): void {
  if (html.trim() === '' || text.trim() === '') {
    throw new Error('MULTIPART_PAYLOAD_REJECTED');
  }
}

/** Escapes a value for HTML text and for a quoted attribute. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** One paragraph of the body. */
function paragraph(text: string): string {
  return `<p style="margin:0 0 16px 0;font-family:${SANS};font-size:16px;line-height:24px;color:${PETROLEO};">${escapeHtml(text)}</p>`;
}

/** The highlighted code. */
function codeBlock(code: string): string {
  return `<p style="margin:8px 0 24px 0;padding:16px;border:1px solid ${OCRE};border-radius:6px;background-color:${MARFIL};text-align:center;font-family:${MONO};font-size:32px;line-height:40px;letter-spacing:8px;font-weight:bold;color:${PETROLEO};">${escapeHtml(code)}</p>`;
}

/** The main action as a bulletproof button (a table cell, which Outlook also draws). */
function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;"><tr><td align="center" bgcolor="${PETROLEO}" style="border-radius:6px;background-color:${PETROLEO};"><a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:16px;line-height:20px;font-weight:bold;color:${MARFIL};text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a></td></tr></table>`;
}

/** The link repeated as text, for clients that do not draw the button. */
function fallbackLink(intro: string, url: string): string {
  return `<p style="margin:0 0 24px 0;font-family:${SANS};font-size:14px;line-height:20px;color:${PETROLEO};">${escapeHtml(intro)}<br><a href="${escapeHtml(url)}" style="color:${PETROLEO};word-break:break-all;">${escapeHtml(url)}</a></p>`;
}

/** One row of the order's tables. */
function row(
  cells: readonly string[],
  opts: { head?: boolean; strong?: boolean } = {}
): string {
  const weight = opts.head || opts.strong ? 'bold' : 'normal';
  const tag = opts.head ? 'th' : 'td';
  return `<tr>${cells
    .map(
      (cell, index) =>
        `<${tag} align="${index === 0 ? 'left' : 'right'}" style="padding:8px 4px;border-bottom:1px solid ${MARFIL};font-family:${SANS};font-size:14px;line-height:20px;font-weight:${weight};color:${PETROLEO};">${escapeHtml(cell)}</${tag}>`
    )
    .join('')}</tr>`;
}

/** The order: summary, lines, totals and delivery address. */
function orderHtml(
  order: OrderBlock,
  words: (typeof FRAME)['es-MX']['order'] | (typeof FRAME)['en']['order']
): string {
  const summary = [
    [words.number, order.number],
    [words.date, order.date],
    [words.method, order.method],
    ...(order.parcel === undefined
      ? []
      : [
          [words.carrier, order.parcel.carrier],
          [words.tracking, order.parcel.trackingNumber],
        ]),
  ];
  const lines = order.lines.map((line) =>
    row([
      `${line.name} (${line.sku})`,
      String(line.quantity),
      line.unitPrice,
      line.lineTotal,
    ])
  );
  const totals = [
    [words.items, order.itemsTotal],
    [words.shipping, order.shipping],
    [words.tax, order.tax],
  ].map(([label, value]) => row([label, '', '', value]));
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">${summary.map(([label, value]) => row([label, value])).join('')}</table>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">${row([words.product, words.quantity, words.unit, words.amount], { head: true })}${lines.join('')}${totals.join('')}${row([words.total, '', '', order.total], { strong: true })}</table>` +
    `<p style="margin:0 0 4px 0;font-family:${SANS};font-size:14px;line-height:20px;font-weight:bold;color:${PETROLEO};">${escapeHtml(words.address)}</p>` +
    `<p style="margin:0 0 24px 0;font-family:${SANS};font-size:14px;line-height:20px;color:${PETROLEO};">${order.address.map(escapeHtml).join('<br>')}</p>`
  );
}

/** The same order as plain text. */
function orderText(
  order: OrderBlock,
  words: (typeof FRAME)['es-MX']['order'] | (typeof FRAME)['en']['order']
): string[] {
  return [
    [
      `${words.number}: ${order.number}`,
      `${words.date}: ${order.date}`,
      `${words.method}: ${order.method}`,
      ...(order.parcel === undefined
        ? []
        : [
            `${words.carrier}: ${order.parcel.carrier}`,
            `${words.tracking}: ${order.parcel.trackingNumber}`,
          ]),
    ].join('\n'),
    [
      ...order.lines.map(
        (line) =>
          `- ${line.name} (${line.sku}) x ${line.quantity} · ${words.unit} ${line.unitPrice} · ${words.amount} ${line.lineTotal}`
      ),
      `${words.items}: ${order.itemsTotal}`,
      `${words.shipping}: ${order.shipping}`,
      `${words.tax}: ${order.tax}`,
      `${words.total}: ${order.total}`,
    ].join('\n'),
    `${words.address}:\n${order.address.join('\n')}`,
  ];
}

/** A security notice, apart from the rest. */
function notice(text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;"><tr><td style="padding:12px 16px;border-left:4px solid ${OCRE};background-color:${MARFIL};font-family:${SANS};font-size:14px;line-height:20px;color:${PETROLEO};">${escapeHtml(text)}</td></tr></table>`;
}

/**
 * Lays a message out (FC 065 T2.1): the HTML and its plain-text twin, both from the same
 * content. The dispatcher checks the multipart gate ({@link assertMultipart}) before sending.
 *
 * @param content - What the message says, in one language.
 * @param siteUrl - The site's address (no trailing slash), for the logo and the footer link.
 * @returns The two bodies.
 */
export function renderEmail(
  content: EmailContent,
  siteUrl: string
): RenderedEmail {
  const frame = FRAME[content.locale];
  const privacyUrl = `${siteUrl}${frame.privacyPath}`;
  const body = [
    ...content.paragraphs.map(paragraph),
    content.order === undefined ? '' : orderHtml(content.order, frame.order),
    content.code === undefined ? '' : codeBlock(content.code),
    content.button === undefined
      ? ''
      : button(content.button.label, content.button.url) +
        fallbackLink(frame.fallbackLink, content.button.url),
    content.notice === undefined ? '' : notice(content.notice),
  ].join('');
  const html = `<!DOCTYPE html><html lang="${content.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(content.heading)}</title></head><body style="margin:0;padding:0;background-color:${MARFIL};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${MARFIL};"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#FFFFFF;border-radius:8px;"><tr><td align="center" bgcolor="${PETROLEO}" style="padding:20px 24px;background-color:${PETROLEO};border-radius:8px 8px 0 0;"><img src="${escapeHtml(siteUrl)}/brand/email/logo.png" width="160" height="40" alt="YĒKORA" style="display:block;border:0;outline:none;text-decoration:none;"></td></tr><tr><td style="padding:32px 28px 16px 28px;"><h1 style="margin:0 0 20px 0;font-family:${SANS};font-size:24px;line-height:32px;font-weight:bold;color:${PETROLEO};">${escapeHtml(content.heading)}</h1>${body}</td></tr><tr><td style="padding:16px 28px 28px 28px;border-top:1px solid ${MARFIL};font-family:${SANS};font-size:13px;line-height:20px;color:${PETROLEO};">${escapeHtml(frame.contact)} <a href="mailto:${SUPPORT_EMAIL}" style="color:${PETROLEO};">${SUPPORT_EMAIL}</a><br><a href="${escapeHtml(privacyUrl)}" style="color:${PETROLEO};">${escapeHtml(frame.privacy)}</a><br>${escapeHtml(frame.unattended)}</td></tr></table></td></tr></table></body></html>`;
  const text = [
    content.heading,
    ...content.paragraphs,
    ...(content.order === undefined
      ? []
      : orderText(content.order, frame.order)),
    ...(content.code === undefined ? [] : [content.code]),
    ...(content.button === undefined
      ? []
      : [`${content.button.label}: ${content.button.url}`]),
    ...(content.notice === undefined ? [] : [content.notice]),
    `${frame.contact} ${SUPPORT_EMAIL}`,
    `${frame.privacy}: ${privacyUrl}`,
    frame.unattended,
  ].join('\n\n');
  return { html, text };
}
