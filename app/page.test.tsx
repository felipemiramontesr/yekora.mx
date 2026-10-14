import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Home from './page';

describe('Home', () => {
  it('renders the unsigned-FC landing', () => {
    const html = renderToStaticMarkup(<Home />);
    expect(html).toContain('NO SIGNED FC');
    expect(html).toContain('001_NS_ProtocolL.md');
  });
});
