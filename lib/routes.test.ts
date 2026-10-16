import { describe, expect, it } from 'vitest';
import { pageFromPath, pageMetadata, routeFor, siteMetadata } from './routes';

describe('routes', () => {
  it('puts Spanish at the root and English under /en/ with translated slugs', () => {
    expect(routeFor('home', 'es-MX')).toBe('/');
    expect(routeFor('home', 'en')).toBe('/en/');
    expect(routeFor('about', 'es-MX')).toBe('/nosotros/');
    expect(routeFor('about', 'en')).toBe('/en/about/');
    expect(routeFor('terms', 'en')).toBe('/en/terms/');
  });

  it('finds the page of a path in either language, with or without the final slash', () => {
    expect(pageFromPath('/privacidad/')).toBe('privacy');
    expect(pageFromPath('/en/privacy')).toBe('privacy');
    expect(pageFromPath('/en/')).toBe('home');
    expect(pageFromPath('/does-not-exist/')).toBe('home');
  });

  it('builds page metadata: canonical in its language, hreflang pair, Spanish x-default', () => {
    expect(pageMetadata('about', 'en')).toEqual({
      title: 'About us | YĒKORA',
      alternates: {
        canonical: '/en/about/',
        languages: {
          'es-MX': '/nosotros/',
          en: '/en/about/',
          'x-default': '/nosotros/',
        },
      },
    });
    expect(pageMetadata('home', 'es-MX').title).toBe('YĒKORA | Tienda Outdoor');
    expect(pageMetadata('cookies', 'es-MX').title).toBe(
      'Política de cookies | YĒKORA'
    );
  });

  it('builds site metadata with the absolute base URL', () => {
    const metadata = siteMetadata('en');
    expect(metadata.metadataBase?.toString()).toBe('https://yekora.mx/');
    expect(metadata.description).toContain('Mexican and international brands');
  });
});
