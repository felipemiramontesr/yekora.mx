import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../globals.css', () => ({}));
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: 'inter-variable' }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/en',
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import LocaleLayout, {
  dynamicParams,
  generateMetadata,
  generateStaticParams,
} from './layout';

const params = (locale: string) => Promise.resolve({ locale });

describe('LocaleLayout', () => {
  it('generates only the supported locales', () => {
    expect(generateStaticParams()).toEqual([
      { locale: 'es-MX' },
      { locale: 'en' },
    ]);
    expect(dynamicParams).toBe(false);
  });

  it('publishes localized site metadata', async () => {
    const metadata = await generateMetadata({ params: params('en') });
    expect(metadata.title).toBe('YĒKORA | Tienda Outdoor');
    expect(metadata.description).toContain('Mexican and international brands');
    expect(metadata.metadataBase?.toString()).toBe('https://yekora.mx/');
  });

  it('renders the document in the requested language with header and footer', async () => {
    const element = await LocaleLayout({
      children: <p>child</p>,
      params: params('es-MX'),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('<html lang="es-MX" class="inter-variable">');
    expect(html).toContain('<main><p>child</p></main>');
    expect(html).toContain('<header');
    expect(html).toContain('<footer');
  });

  it('answers 404 for an unsupported locale', async () => {
    await expect(
      LocaleLayout({ children: null, params: params('fr') })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
