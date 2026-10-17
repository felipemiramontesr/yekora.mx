import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OfflineView } from './OfflineView';

describe('OfflineView', () => {
  it('tells Spanish visitors they are offline, with decorative icons only', () => {
    const html = renderToStaticMarkup(<OfflineView locale="es-MX" />);
    expect(html).toMatch(/<h1[^>]*>Estás fuera de cobertura<\/h1>/);
    expect(html).toContain('siguen disponibles');
    const icons = html.match(/<svg[^>]*>/g) ?? [];
    expect(icons).toHaveLength(2);
    for (const icon of icons) expect(icon).toContain('aria-hidden="true"');
  });

  it('retries with a plain link to the current URL, so it works without JavaScript', () => {
    const html = renderToStaticMarkup(<OfflineView locale="es-MX" />);
    expect(html).toMatch(/<a href=""[^>]*>[\s\S]*Reintentar<\/a>/);
    expect(html).not.toContain('<button');
  });

  it('is translated to English', () => {
    const html = renderToStaticMarkup(<OfflineView locale="en" />);
    expect(html).toMatch(/<h1[^>]*>You are out of coverage<\/h1>/);
    expect(html).toMatch(/<a href=""[^>]*>[\s\S]*Try again<\/a>/);
  });
});
