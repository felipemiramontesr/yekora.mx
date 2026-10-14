import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./globals.css', () => ({}));

import RootLayout, { metadata } from './layout';

describe('RootLayout', () => {
  it('publishes the landing metadata', () => {
    expect(metadata.title).toBe('Protocol L');
    expect(metadata.description).toContain('NO SIGNED FC');
  });

  it('wraps children in the document', () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>child</p>
      </RootLayout>
    );
    expect(html).toContain('child');
    expect(html).toContain('<html');
  });
});
