// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recallDeliveryPlace, rememberDeliveryPlace } from './deliveryPlace';

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('delivery place of the tab (FC 055 T2.6, T2.9)', () => {
  it.each([
    ['06600', '06600'],
    ['ZAC', 'ZAC'],
    ['MX-ZAC', 'ZAC'],
    ['19.43,-99.13', null],
    ['', null],
  ])('reads the stored %j as the place %j', (stored, expected) => {
    sessionStorage.setItem('yekora_delivery_place_v1', stored);
    expect(recallDeliveryPlace()).toBe(expected);
  });

  it('keeps a postal code or a state in this tab only, under its own name', () => {
    rememberDeliveryPlace('06600');
    expect(sessionStorage.getItem('yekora_delivery_place_v1')).toBe('06600');
    expect(recallDeliveryPlace()).toBe('06600');
    rememberDeliveryPlace('ZAC');
    expect(recallDeliveryPlace()).toBe('ZAC');
    expect(localStorage.getItem('yekora_delivery_place_v1')).toBeNull();
  });

  it('recalls nothing when nothing, or something that is not a place, is stored', () => {
    expect(recallDeliveryPlace()).toBeNull();
    sessionStorage.setItem('yekora_delivery_place_v1', '19.43,-99.13');
    expect(recallDeliveryPlace()).toBeNull();
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
    expect(() => rememberDeliveryPlace('06600', refusing)).not.toThrow();
    expect(recallDeliveryPlace(refusing)).toBeNull();
    expect(() => rememberDeliveryPlace('06600', null)).not.toThrow();
    expect(recallDeliveryPlace(null)).toBeNull();
  });

  it('has nothing to read or write where there is no window, as on the server', () => {
    vi.stubGlobal('window', undefined);
    expect(recallDeliveryPlace()).toBeNull();
    expect(() => rememberDeliveryPlace('06600')).not.toThrow();
  });

  it('is blocked quietly when the browser denies access to session storage', () => {
    const denied = vi
      .spyOn(globalThis.window, 'sessionStorage', 'get')
      .mockImplementation(() => {
        throw new Error('SecurityError');
      });
    expect(recallDeliveryPlace()).toBeNull();
    expect(() => rememberDeliveryPlace('06600')).not.toThrow();
    denied.mockRestore();
  });
});
