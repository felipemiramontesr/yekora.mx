// @vitest-environment jsdom
/**
 * FC 078 F0 evidence: every public page that needs it says where one is (T2.5), in both languages,
 * and the catalog adds the discipline its address asks for.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMessages, type Locale } from '@/app/i18n';
import { CatalogTrail } from './catalog/CatalogTrail';
import { AboutView } from './views/AboutView';
import { CartView } from './views/CartView';
import { CheckoutView } from './views/CheckoutView';
import { LegalView } from './views/LegalView';
import { ShippingReturnsView } from './views/ShippingReturnsView';

const search = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', async (original) => ({
  ...(await original<typeof import('next/navigation')>()),
  useSearchParams: () => new URLSearchParams(search.value),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  search.value = '';
});

/** The names of the steps of the trail on screen. */
const steps = (label: string) =>
  within(screen.getByRole('navigation', { name: label }))
    .getAllByRole('listitem')
    .map((item) => item.textContent?.replace('›', ''));

describe('the trail of the public pages', () => {
  it.each([
    ['about', <AboutView key="a" locale="es-MX" />, ['Inicio', 'Nosotros']],
    ['cart', <CartView key="c" locale="es-MX" />, ['Inicio', 'Mochila']],
    [
      'checkout',
      <CheckoutView key="k" locale="es-MX" />,
      ['Inicio', 'Mochila', 'Pago'],
    ],
    [
      'privacy',
      <LegalView key="p" locale="es-MX" document="privacy" />,
      ['Inicio', getMessages('es-MX').legal.privacy.title],
    ],
    [
      'cookies',
      <LegalView key="o" locale="es-MX" document="cookies" />,
      ['Inicio', getMessages('es-MX').legal.cookies.title],
    ],
    [
      'shipping',
      <ShippingReturnsView key="s" locale="es-MX" />,
      ['Inicio', getMessages('es-MX').legal.shipping.title],
    ],
  ])('says where the %s page is', (_page, view, expected) => {
    const html = renderToStaticMarkup(view);
    document.body.innerHTML = html;
    expect(steps('Estás en')).toEqual(expected);
    document.body.innerHTML = '';
  });

  it.each([
    ['es-MX', 'Estás en', '', ['Inicio', 'Catálogo']],
    ['es-MX', 'Estás en', 'disciplina=nada', ['Inicio', 'Catálogo']],
    [
      'es-MX',
      'Estás en',
      'disciplina=escalada',
      ['Inicio', 'Catálogo', 'Escalada'],
    ],
    ['en', 'You are here', '', ['Home', 'Catalog']],
  ])(
    'gives the catalog its trail (%s, "%s%s")',
    (locale, label, query, expected) => {
      search.value = query;
      render(<CatalogTrail locale={locale as Locale} />);
      expect(steps(label)).toEqual(expected);
    }
  );
});
