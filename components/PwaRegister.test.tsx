// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PwaRegister } from './PwaRegister';

const register = vi.fn();

function withServiceWorker(result: Promise<unknown>) {
  register.mockReturnValue(result);
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { register },
    configurable: true,
  });
}

function setReadyState(state: DocumentReadyState) {
  Object.defineProperty(document, 'readyState', {
    value: state,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  register.mockReset();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  setReadyState('complete');
});

describe('PwaRegister', () => {
  it('renders nothing and never registers outside production', () => {
    withServiceWorker(Promise.resolve());
    const { container } = render(<PwaRegister />);
    expect(container.innerHTML).toBe('');
    expect(register).not.toHaveBeenCalled();
  });

  it('does nothing in browsers without service workers', () => {
    vi.stubEnv('NODE_ENV', 'production');
    render(<PwaRegister />);
    expect(register).not.toHaveBeenCalled();
  });

  it('registers /sw.js right away when the page has already loaded', () => {
    vi.stubEnv('NODE_ENV', 'production');
    withServiceWorker(Promise.resolve());
    render(<PwaRegister />);
    expect(register).toHaveBeenCalledWith('/sw.js');
  });

  it('waits for the load event otherwise, and stops waiting when unmounted', () => {
    vi.stubEnv('NODE_ENV', 'production');
    withServiceWorker(Promise.resolve());
    setReadyState('loading');
    const { unmount } = render(<PwaRegister />);
    expect(register).not.toHaveBeenCalled();
    globalThis.dispatchEvent(new Event('load'));
    expect(register).toHaveBeenCalledTimes(1);

    register.mockClear();
    const second = render(<PwaRegister />);
    second.unmount();
    globalThis.dispatchEvent(new Event('load'));
    expect(register).not.toHaveBeenCalled();
    unmount();
  });

  it('reports a failed registration without breaking the page', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    withServiceWorker(Promise.reject(new Error('blocked')));
    render(<PwaRegister />);
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        '[pwa] service worker registration failed',
        expect.any(Error)
      )
    );
  });
});
