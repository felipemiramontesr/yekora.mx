// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getMessages } from '@/app/i18n';
import { SessionSkeleton } from './SessionSkeleton';

afterEach(cleanup);

describe('session skeleton (FC 053 T1.1, T2.1)', () => {
  it('is a busy status that says, to assistive technology, what it waits for, and shows only grey shapes', () => {
    const text = getMessages('es-MX').account.sessionLoading;
    const { container } = render(<SessionSkeleton text={text} />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.hasAttribute('data-session-skeleton')).toBe(true);
    expect(text).toBe('Confirmando tu sesión…');
    expect(screen.getByText(text).className).toContain('sr-only');
    // Nothing a visitor would act on: no field, no button, no link, no sign-in text.
    expect(container.querySelector('input, button, a')).toBeNull();
    expect(container.textContent).not.toMatch(/Entrar|Sign in/);
    // The shapes are decoration.
    for (const shape of container.querySelectorAll('[aria-hidden="true"]')) {
      expect(shape.textContent).toBe('');
    }
  });

  it('speaks both languages', () => {
    expect(getMessages('en').account.sessionLoading).toBe(
      'Confirming your session…'
    );
  });
});
