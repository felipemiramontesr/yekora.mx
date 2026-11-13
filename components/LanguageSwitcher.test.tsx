// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/app/i18n';
import { LanguageSwitcher } from './LanguageSwitcher';

const pathname = vi.hoisted(() => ({ current: null as string | null }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

afterEach(cleanup);

describe('LanguageSwitcher', () => {
  it('links the same page in each language and marks the current one', () => {
    pathname.current = '/nosotros/';
    render(
      <LanguageSwitcher
        locale="es-MX"
        messages={getMessages('es-MX').languageSwitcher}
      />
    );
    const english = screen.getByRole('link', { name: /English/ });
    const spanish = screen.getByRole('link', { name: /Español/ });
    expect(english.getAttribute('href')).toBe('/en/about/');
    expect(english.getAttribute('hreflang')).toBe('en');
    expect(english.getAttribute('aria-current')).toBeNull();
    expect(spanish.getAttribute('href')).toBe('/nosotros/');
    expect(spanish.getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('navigation', { name: 'Idioma' })).toBeTruthy();
  });

  it('shows only the two-letter codes, with the full language as the accessible name (FC 046 T2.1)', () => {
    pathname.current = '/nosotros/';
    const { container } = render(
      <LanguageSwitcher
        locale="es-MX"
        messages={getMessages('es-MX').languageSwitcher}
      />
    );
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['ES', 'EN']);
    // The accessible name starts with the visible code and then names the language in full
    // (WCAG 2.5.3 Label in Name).
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'ES, Español',
      'EN, English',
    ]);
    expect(links.map((link) => link.getAttribute('lang'))).toEqual([
      'es-MX',
      'en',
    ]);
    // No globe and no full names on screen; each link keeps its 44 px touch target.
    expect(container.querySelector('svg')).toBeNull();
    for (const link of links) expect(link.className).toContain('tap-target');
  });

  it('highlights the current language and leaves the other as a link to switch to', () => {
    pathname.current = '/';
    render(
      <LanguageSwitcher
        locale="en"
        messages={getMessages('en').languageSwitcher}
      />
    );
    const current = screen.getByRole('link', { name: /English/ });
    const other = screen.getByRole('link', { name: /Español/ });
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(current.className).toContain('bg-marfil');
    expect(other.getAttribute('aria-current')).toBeNull();
    expect(other.className).not.toContain('bg-marfil');
  });

  it('keeps the same product on a product page (FC 008)', () => {
    pathname.current = '/catalogo/arnes-alpino/';
    render(
      <LanguageSwitcher
        locale="es-MX"
        messages={getMessages('es-MX').languageSwitcher}
      />
    );
    expect(
      screen.getByRole('link', { name: /English/ }).getAttribute('href')
    ).toBe('/en/catalog/arnes-alpino/');
  });

  it('falls back to the locale root when the path is unknown', () => {
    pathname.current = null;
    render(
      <LanguageSwitcher
        locale="en"
        messages={getMessages('en').languageSwitcher}
      />
    );
    expect(
      screen.getByRole('link', { name: /Español/ }).getAttribute('href')
    ).toBe('/');
    expect(screen.getByRole('navigation', { name: 'Language' })).toBeTruthy();
  });
});
