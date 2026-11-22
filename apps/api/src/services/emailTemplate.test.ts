/**
 * FC 065 F0 evidence of the branded e-mail template: the logo is a real file at the fixed path
 * (T0.1 of the plan), the HTML is tables with inline styles in the palette of the site and a
 * sized logo with alternative text (T2.1), the plain text carries the same facts without markup
 * (T2.3), the language resolves in the four rows of T1.1, the multipart gate has its four rows
 * (T1.2), and nothing typed into a message can add markup (T2.1 hardening).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertMultipart,
  type EmailContent,
  renderEmail,
  resolveMailLocale,
} from './emailTemplate';

const SITE = 'https://yekora.mx';

const CONTENT: EmailContent = {
  locale: 'es-MX',
  heading: 'Tu código de acceso',
  paragraphs: ['Escribe este código.', 'Vence en 5 minutos.'],
  code: '482913',
  button: { label: 'Abrir enlace', url: `${SITE}/cuenta/?a=1&b=2` },
  notice: 'Si no fuiste tú, avísanos.',
};

describe('the logo of the e-mails (FC 065 T0.1)', () => {
  const logo = fileURLToPath(
    new URL('../../../../public/brand/email/logo.png', import.meta.url)
  );

  it('is a PNG of 320 × 80 pixels at the fixed path, shown at 160 × 40', () => {
    expect(existsSync(logo)).toBe(true);
    const bytes = readFileSync(logo);
    expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(bytes.readUInt32BE(16)).toBe(320);
    expect(bytes.readUInt32BE(20)).toBe(80);
    expect(renderEmail(CONTENT, SITE).html).toContain(
      `<img src="${SITE}/brand/email/logo.png" width="160" height="40" alt="YĒKORA"`
    );
  });
});

describe('the HTML body (FC 065 T2.1)', () => {
  const { html } = renderEmail(CONTENT, SITE);

  it('is tables with inline styles, a sized logo with alternative text and no script', () => {
    expect(html.startsWith('<!DOCTYPE html><html lang="es-MX">')).toBe(true);
    expect(html).toContain('<table role="presentation"');
    expect(html).toContain('style="');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
    expect(html).toContain('alt="YĒKORA"');
  });

  it('uses the palette of the site: petróleo, marfil and ocre', () => {
    for (const color of ['#213C41', '#F8F5EE', '#AD843E']) {
      expect(html).toContain(color);
    }
  });

  it('shows the code highlighted, the action as a button with its link repeated, and the notice apart', () => {
    expect(html).toContain('482913');
    expect(html).toContain('letter-spacing:8px');
    expect(html).toContain('>Abrir enlace</a>');
    expect(html.match(/cuenta\/\?a=1&amp;b=2/g)).toHaveLength(3);
    expect(html).toContain('Si no fuiste tú, avísanos.');
    expect(html).toContain('border-left:4px solid #AD843E');
  });

  it('closes with the support address, the privacy notice of its language and the unattended note', () => {
    expect(html).toContain('href="mailto:contacto@yekora.mx"');
    expect(html).toContain(`href="${SITE}/privacidad/"`);
    expect(html).toContain('no respondas a este correo');
    const english = renderEmail({ ...CONTENT, locale: 'en' }, SITE).html;
    expect(english).toContain('<html lang="en">');
    expect(english).toContain(`href="${SITE}/en/privacy/"`);
    expect(english).not.toContain('/privacidad/');
    expect(english).toContain('do not reply to it');
  });

  it('leaves out the code, the button and the notice when the message has none', () => {
    const plain = renderEmail(
      { locale: 'es-MX', heading: 'Aviso', paragraphs: ['Hola.'] },
      SITE
    ).html;
    expect(plain).not.toContain('letter-spacing:8px');
    expect(plain).not.toContain('border-radius:6px;"><a ');
    expect(plain).not.toContain('border-left:4px');
    expect(plain).toContain('Hola.');
  });

  it('escapes every value, so nothing typed into a message adds markup or breaks an attribute', () => {
    const hostile = renderEmail(
      {
        locale: 'es-MX',
        heading: '<img src=x onerror=alert(1)>',
        paragraphs: ['<script>alert(1)</script> & "quotes" \'single\''],
        code: '"><b>',
        button: { label: '<i>go</i>', url: 'https://x.test/?a="1"&b=<2>' },
        notice: '<u>careful</u>',
      },
      SITE
    ).html;
    expect(hostile).not.toContain('<script>alert');
    expect(hostile).not.toContain('<img src=x');
    expect(hostile).not.toContain('<b>');
    expect(hostile).not.toContain('<i>go');
    expect(hostile).not.toContain('<u>careful');
    expect(hostile).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot; &#39;single&#39;'
    );
    expect(hostile).toContain(
      'href="https://x.test/?a=&quot;1&quot;&amp;b=&lt;2&gt;"'
    );
  });
});

describe('the plain-text twin (FC 065 T2.3)', () => {
  it('carries the same facts as the HTML, without any markup', () => {
    const { text } = renderEmail(CONTENT, SITE);
    expect(text).toContain('Tu código de acceso');
    expect(text).toContain('Escribe este código.');
    expect(text).toContain('Vence en 5 minutos.');
    expect(text).toContain('482913');
    expect(text).toContain(`Abrir enlace: ${SITE}/cuenta/?a=1&b=2`);
    expect(text).toContain('Si no fuiste tú, avísanos.');
    expect(text).toContain('contacto@yekora.mx');
    expect(text).toContain(`Aviso de privacidad: ${SITE}/privacidad/`);
    expect(text).toContain('no respondas a este correo');
    expect(text).not.toMatch(/<[a-z/]/i);
    expect(text).not.toContain('&amp;');
  });

  it('is in English only for an English message, and holds just the title, paragraphs and footer without a code, button or notice', () => {
    const { text } = renderEmail(
      { locale: 'en', heading: 'Notice', paragraphs: ['Hello.'] },
      SITE
    );
    expect(text).toBe(
      [
        'Notice',
        'Hello.',
        'Write to us at contacto@yekora.mx',
        `Privacy notice: ${SITE}/en/privacy/`,
        'This message was generated automatically; do not reply to it.',
      ].join('\n\n')
    );
  });
});

describe('MailLocaleResolutionGate (FC 065 T1.1)', () => {
  it.each([
    ['en', 'en'],
    ['es-MX', 'es-MX'],
    [undefined, 'es-MX'],
    ['fr', 'es-MX'],
    ['EN', 'es-MX'],
  ] as const)('resolves %j to %s', (requested, expected) => {
    expect(resolveMailLocale(requested)).toBe(expected);
  });
});

describe('MailMultipartRenderingGate (FC 065 T1.2)', () => {
  it.each([
    ['H ⊤ T ⊤', '<p>x</p>', 'x', true],
    ['H ⊤ T ⊥', '<p>x</p>', '  ', false],
    ['H ⊥ T ⊤', '', 'x', false],
    ['H ⊥ T ⊥', ' ', '', false],
  ] as const)('%s', (_row, html, text, admitted) => {
    if (admitted) {
      expect(() => assertMultipart(html, text)).not.toThrow();
    } else {
      expect(() => assertMultipart(html, text)).toThrow(
        'MULTIPART_PAYLOAD_REJECTED'
      );
    }
  });
});
