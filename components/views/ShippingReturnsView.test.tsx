import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShippingReturnsView } from './ShippingReturnsView';

describe('ShippingReturnsView', () => {
  it('states the Spanish policy Ω approved (K-08)', () => {
    const html = renderToStaticMarkup(<ShippingReturnsView locale="es-MX" />);
    expect(html).toMatch(/<h1[^>]*>Envíos y devoluciones<\/h1>/);
    expect(html).toContain('a toda la República Mexicana');
    expect(html).toContain('30 días naturales a partir de la entrega');
    expect(html).toContain('hasta 10 días hábiles a partir de que recibimos');
    expect(html).toContain('garantía oficial de su fabricante');
    expect(html).toContain('contacto@yekora.mx');
    expect(html).toContain('492 942 1780');
  });

  // T1.1: TiendaPaga ⟺ D (damaged, defective or wrong); ClientePaga ⟺ ¬D ∧ O (change of mind).
  it('assigns the return shipping cost as truth table T1.1 says', () => {
    const html = renderToStaticMarkup(<ShippingReturnsView locale="es-MX" />);
    expect(html).toContain(
      'Si el producto llegó dañado, defectuoso o no es el que pediste, YĒKORA cubre el envío de devolución'
    );
    expect(html).toContain(
      'Si lo devuelves por cambio de opinión, de preferencia o de talla, el envío de devolución corre por tu cuenta'
    );
  });

  it('is translated to English with the same rules', () => {
    const html = renderToStaticMarkup(<ShippingReturnsView locale="en" />);
    expect(html).toMatch(/<h1[^>]*>Shipping and returns<\/h1>/);
    expect(html).toContain('30 calendar days from delivery');
    expect(html).toContain(
      'within 10 business days after we receive the return'
    );
    expect(html).toContain('YĒKORA covers the return shipping');
  });
});
