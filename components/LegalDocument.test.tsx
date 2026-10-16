import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getMessages } from '@/app/i18n';
import { LegalDocument } from './LegalDocument';

describe('LegalDocument', () => {
  const { legal } = getMessages('es-MX');

  it('renders the title, update date, review notice and every section', () => {
    const html = renderToStaticMarkup(
      <LegalDocument legal={legal} document={legal.terms} />
    );
    expect(html).toContain('<h1');
    expect(html).toContain('Última actualización: 15 de octubre de 2026');
    expect(html).toContain('role="note"');
    expect(html.match(/<h2/g)).toHaveLength(legal.terms.sections.length);
  });

  it('appends extra content after the sections', () => {
    const html = renderToStaticMarkup(
      <LegalDocument legal={legal} document={legal.cookies}>
        <p>extra</p>
      </LegalDocument>
    );
    expect(html.endsWith('<p>extra</p></article>')).toBe(true);
  });
});
