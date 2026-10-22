import { describe, expect, it } from 'vitest';
import { CHECKOUT_RETURN_PATHS } from './checkout/checkoutTypes';
import {
  pageMetadata,
  productMetadata,
  productPath,
  routeFor,
  siteMetadata,
  translatePath,
} from './routes';

describe('routes', () => {
  it('puts Spanish at the root and English under /en/ with translated slugs', () => {
    expect(routeFor('home', 'es-MX')).toBe('/');
    expect(routeFor('home', 'en')).toBe('/en/');
    expect(routeFor('about', 'es-MX')).toBe('/nosotros/');
    expect(routeFor('about', 'en')).toBe('/en/about/');
    expect(routeFor('terms', 'en')).toBe('/en/terms/');
    expect(routeFor('offline', 'en')).toBe('/en/offline/');
  });

  it('serves the return pages exactly where the API sends the processors (FC 012)', () => {
    for (const locale of ['es-MX', 'en'] as const) {
      expect(routeFor('checkoutSuccess', locale)).toBe(
        CHECKOUT_RETURN_PATHS[locale].success
      );
      expect(routeFor('checkoutCancel', locale)).toBe(
        CHECKOUT_RETURN_PATHS[locale].cancel
      );
    }
    expect(routeFor('checkout', 'es-MX')).toBe('/checkout/');
    expect(translatePath('/checkout/exito/', 'en')).toBe(
      '/en/checkout/success/'
    );
    expect(translatePath('/en/checkout/cancel', 'es-MX')).toBe(
      '/checkout/cancelado/'
    );
  });

  it('translates a path to the same page in the other language, with or without the final slash', () => {
    expect(translatePath('/privacidad/', 'en')).toBe('/en/privacy/');
    expect(translatePath('/en/privacy', 'es-MX')).toBe('/privacidad/');
    expect(translatePath('/en/', 'es-MX')).toBe('/');
    expect(translatePath('/does-not-exist/', 'en')).toBe('/en/');
    expect(translatePath('/catalogo/', 'en')).toBe('/en/catalog/');
  });

  it('keeps the product when translating a product page (FC 008)', () => {
    expect(productPath('arnes-alpino', 'es-MX')).toBe(
      '/catalogo/arnes-alpino/'
    );
    expect(translatePath('/catalogo/arnes-alpino/', 'en')).toBe(
      '/en/catalog/arnes-alpino/'
    );
    expect(translatePath('/en/catalog/arnes-alpino', 'es-MX')).toBe(
      '/catalogo/arnes-alpino/'
    );
    expect(translatePath('/en/catalog/arnes-alpino/', 'en')).toBe(
      '/en/catalog/arnes-alpino/'
    );
  });

  it('builds product metadata from the product, with hreflang to the same product', () => {
    expect(
      productMetadata(
        { slug: 'arnes-alpino', name: 'Alpine harness', description: 'Light.' },
        'en'
      )
    ).toEqual({
      title: 'Alpine harness | YĒKORA',
      description: 'Light.',
      alternates: {
        canonical: '/en/catalog/arnes-alpino/',
        languages: {
          'es-MX': '/catalogo/arnes-alpino/',
          en: '/en/catalog/arnes-alpino/',
          'x-default': '/catalogo/arnes-alpino/',
        },
      },
    });
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
    expect(pageMetadata('offline', 'es-MX').title).toBe(
      'Sin conexión | YĒKORA'
    );
    expect(pageMetadata('cookies', 'es-MX').title).toBe(
      'Política de cookies | YĒKORA'
    );
    expect(pageMetadata('catalog', 'en').title).toBe('Catalog | YĒKORA');
  });

  it('builds site metadata with the absolute base URL', () => {
    const metadata = siteMetadata('en');
    expect(metadata.metadataBase?.toString()).toBe('https://yekora.mx/');
    expect(metadata.description).toContain('Mexican and international brands');
  });
});
