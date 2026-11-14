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
});
