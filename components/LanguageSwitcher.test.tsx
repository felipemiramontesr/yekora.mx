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
    const english = screen.getByRole('link', { name: 'English' });
    const spanish = screen.getByRole('link', { name: 'Español' });
    expect(english.getAttribute('href')).toBe('/en/about/');
    expect(english.getAttribute('hreflang')).toBe('en');
    expect(english.getAttribute('aria-current')).toBeNull();
    expect(spanish.getAttribute('href')).toBe('/nosotros/');
    expect(spanish.getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('navigation', { name: 'Idioma' })).toBeTruthy();
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
      screen.getByRole('link', { name: 'Español' }).getAttribute('href')
    ).toBe('/');
    expect(screen.getByRole('navigation', { name: 'Language' })).toBeTruthy();
  });
});
