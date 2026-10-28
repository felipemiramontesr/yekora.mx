// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/app/i18n';
import { CartDrawer } from './CartDrawer';

// A ref that React can never fill: the only way to reach the drawer's guard for a dialog that is
// not mounted yet, which a real render never produces (FC 017, Vitest 4 counts that branch).
const detached = vi.hoisted(() => ({ on: false }));

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return {
    ...react,
    useRef: <T,>(initial: T) => {
      const ref = react.useRef(initial);
      if (!detached.on) return ref;
      return {
        get current() {
          return null;
        },
        set current(_value) {
          // React attaches the dialog here; drop it so the effect sees no element.
        },
      };
    },
  };
});

afterEach(() => {
  detached.on = false;
  cleanup();
});

describe('CartDrawer without its dialog element', () => {
  it('does nothing until the dialog exists, whether asked to open or to close', () => {
    detached.on = true;
    const showModal = vi.fn();
    const close = vi.fn();
    HTMLDialogElement.prototype.showModal = showModal;
    HTMLDialogElement.prototype.close = close;
    const messages = getMessages('es-MX');
    const props = {
      onClose: vi.fn(),
      locale: 'es-MX' as const,
      messages: messages.cart,
      priceMessages: messages.catalog.price,
    };
    const { rerender } = render(<CartDrawer open={false} {...props} />);
    rerender(<CartDrawer open {...props} />);
    expect(showModal).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
