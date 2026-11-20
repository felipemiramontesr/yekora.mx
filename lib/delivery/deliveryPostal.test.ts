// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recallDeliveryPostal, rememberDeliveryPostal } from './deliveryPostal';

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('delivery postal code of the tab (FC 055 T2.6)', () => {
  it('keeps the code in this tab only, under its own name', () => {
    rememberDeliveryPostal('06600');
    expect(sessionStorage.getItem('yekora_delivery_postal_v1')).toBe('06600');
    expect(recallDeliveryPostal()).toBe('06600');
    expect(localStorage.getItem('yekora_delivery_postal_v1')).toBeNull();
  });

  it('recalls nothing when nothing, or something that is not a postal code, is stored', () => {
    expect(recallDeliveryPostal()).toBeNull();
    sessionStorage.setItem('yekora_delivery_postal_v1', '19.43,-99.13');
    expect(recallDeliveryPostal()).toBeNull();
  });

  it('never throws when storage refuses: quota, privacy mode or no storage', () => {
    const refusing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    } as unknown as Storage;
    expect(() => rememberDeliveryPostal('06600', refusing)).not.toThrow();
    expect(recallDeliveryPostal(refusing)).toBeNull();
    expect(() => rememberDeliveryPostal('06600', null)).not.toThrow();
    expect(recallDeliveryPostal(null)).toBeNull();
  });

  it('has nothing to read or write where there is no window, as on the server', () => {
    vi.stubGlobal('window', undefined);
    expect(recallDeliveryPostal()).toBeNull();
    expect(() => rememberDeliveryPostal('06600')).not.toThrow();
  });

  it('is blocked quietly when the browser denies access to session storage', () => {
    const denied = vi
      .spyOn(globalThis.window, 'sessionStorage', 'get')
      .mockImplementation(() => {
        throw new Error('SecurityError');
      });
    expect(recallDeliveryPostal()).toBeNull();
    expect(() => rememberDeliveryPostal('06600')).not.toThrow();
    denied.mockRestore();
  });
});
