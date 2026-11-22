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

/** What one message says, before it is laid out. */
export interface EmailContent {
  /** Language of the whole message. */
  locale: MailLocale;
  /** The title of the message. */
  heading: string;
  /** Paragraphs, in order, shown before the code and the button. */
  paragraphs: readonly string[];
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
  },
  en: {
    fallbackLink:
      'If the button does not work, copy this link into your browser:',
    contact: 'Write to us at',
    privacy: 'Privacy notice',
    privacyPath: '/en/privacy/',
    unattended: 'This message was generated automatically; do not reply to it.',
  },
} as const;

/**
 * The language a message is written in (T1.1): English only when the event asked for it
 * explicitly, Mexican Spanish in every other case, so a message never mixes the two.
 *
 * @param requested - The language the event named, if any.
 * @returns `en` or `es-MX`.
 */
export function resolveMailLocale(requested: string | undefined): MailLocale {
  return requested === 'en' ? 'en' : 'es-MX';
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
