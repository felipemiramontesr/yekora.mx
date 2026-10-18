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

  it('retries with a no-action GET form, so it works without JavaScript', () => {
    const html = renderToStaticMarkup(<OfflineView locale="es-MX" />);
    expect(html).toMatch(
      /<form method="get"><button type="submit"[^>]*>[\s\S]*Reintentar<\/button><\/form>/
    );
    expect(html).not.toContain('action=');
    expect(html).not.toContain('<a ');
  });

  it('is translated to English', () => {
    const html = renderToStaticMarkup(<OfflineView locale="en" />);
    expect(html).toMatch(/<h1[^>]*>You are out of coverage<\/h1>/);
    expect(html).toMatch(
      /<button type="submit"[^>]*>[\s\S]*Try again<\/button>/
    );
  });
});
