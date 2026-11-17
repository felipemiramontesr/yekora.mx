import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/globals.css', () => ({}));
vi.mock('next/font/local', () => ({
  default: (options: { variable: string }) => ({
    variable: options.variable.slice(2),
  }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/en/',
  useRouter: () => ({ push: vi.fn() }),
}));

import { SiteShell } from './SiteShell';

describe('SiteShell', () => {
  it('renders the document in its language with header, main and footer', () => {
    const html = renderToStaticMarkup(
      <SiteShell locale="en">
        <p>child</p>
      </SiteShell>
    );
    expect(html).toContain(
      '<html lang="en" class="font-inter font-inter-ext">'
    );
    expect(html).toContain('<main><p>child</p></main>');
    expect(html).toContain('<header');
    expect(html).toContain('<footer');
  });

  it('marks the document from the session hint before the first paint, with a script in the head (FC 053 T1.1)', () => {
    const html = renderToStaticMarkup(
      <SiteShell locale="es-MX">
        <p>child</p>
      </SiteShell>
    );
    const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? '';
    expect(head).toContain('<script>');
    expect(head).toContain('yekora_session_first_name_v1');
    expect(head).toContain('data-session');
    // The script runs before anything of the body exists.
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('<body'));
  });
});
