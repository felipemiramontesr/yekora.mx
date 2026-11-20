// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { placeOf } from '@/lib/delivery/reverseGeocode';
import { useDeliveryLocation } from './useDeliveryLocation';

vi.mock('@/lib/delivery/reverseGeocode', async (original) => ({
  ...(await original<typeof import('@/lib/delivery/reverseGeocode')>()),
  placeOf: vi.fn(),
}));
const geocode = vi.mocked(placeOf);

type Success = (position: { coords: object }) => void;
let ask: ReturnType<typeof vi.fn>;
let deny: () => void;
let grant: (coords?: object) => void;

function allow() {
  document.cookie = `yekora_location_consent=1; Path=/`;
}

beforeEach(() => {
  ask = vi.fn((onSuccess: Success, onError: () => void) => {
    grant = (coords = { latitude: 19.4, longitude: -99.1 }) =>
      onSuccess({ coords });
    deny = onError;
  });
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: ask },
  });
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  document.cookie = `yekora_location_consent=; Max-Age=0; Path=/`;
  Reflect.deleteProperty(globalThis.navigator, 'geolocation');
  vi.clearAllMocks();
});

describe('useDeliveryLocation (FC 055 T1.2, T2.6 to T2.8)', () => {
  it('never asks the browser for the position before the visitor said yes', () => {
    const { result } = renderHook(() => useDeliveryLocation(true));
    expect(result.current).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });

  it('never asks while it is not enabled, even with the yes', () => {
    allow();
    const { result } = renderHook(() => useDeliveryLocation(false));
    expect(result.current).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks once the yes is given, turns the position into a postal code and remembers it for the tab', async () => {
    geocode.mockResolvedValue('06600');
    const { result } = renderHook(() => useDeliveryLocation(true));
    act(() => {
      document.cookie = `yekora_location_consent=1; Path=/`;
      globalThis.dispatchEvent(new Event('yekora:location-consent'));
    });
    expect(ask).toHaveBeenCalledOnce();
    expect(ask.mock.calls[0]?.[2]).toEqual({
      timeout: 10_000,
      maximumAge: 600_000,
    });
    act(() => grant());
    await waitFor(() => expect(result.current).toBe('06600'));
    expect(sessionStorage.getItem('yekora_delivery_place_v1')).toBe('06600');
    // The coordinates went to the geocoder and nowhere else.
    expect(geocode.mock.calls[0]?.[0]).toEqual({
      latitude: 19.4,
      longitude: -99.1,
    });
    expect(JSON.stringify(sessionStorage)).not.toContain('19.4');
  });

  it('keeps the state when no service knows a postal code, and reuses it in this tab', async () => {
    allow();
    geocode.mockResolvedValue('ZAC');
    const { result } = renderHook(() => useDeliveryLocation(true));
    act(() => grant());
    await waitFor(() => expect(result.current).toBe('ZAC'));
    expect(sessionStorage.getItem('yekora_delivery_place_v1')).toBe('ZAC');
  });

  it('reuses the code of this tab without asking the browser again', () => {
    allow();
    sessionStorage.setItem('yekora_delivery_place_v1', '98000');
    const { result } = renderHook(() => useDeliveryLocation(true));
    expect(result.current).toBe('98000');
    expect(ask).not.toHaveBeenCalled();
  });

  it('stays silent when the permission is denied or the browser fails', () => {
    allow();
    const { result } = renderHook(() => useDeliveryLocation(true));
    expect(ask).toHaveBeenCalledOnce();
    act(() => deny());
    expect(result.current).toBeNull();
    expect(geocode).not.toHaveBeenCalled();
  });

  it('stays silent when no service names a postal code', async () => {
    allow();
    geocode.mockResolvedValue(null);
    const { result } = renderHook(() => useDeliveryLocation(true));
    act(() => grant());
    await waitFor(() => expect(geocode).toHaveBeenCalledOnce());
    expect(result.current).toBeNull();
    expect(sessionStorage.getItem('yekora_delivery_place_v1')).toBeNull();
  });

  it('stays silent when the browser has no geolocation', () => {
    allow();
    Reflect.deleteProperty(globalThis.navigator, 'geolocation');
    const { result } = renderHook(() => useDeliveryLocation(true));
    expect(result.current).toBeNull();
  });

  it('drops the answer of a geocoder that comes back after the page is gone', async () => {
    allow();
    const late: { resolve?: (code: string | null) => void } = {};
    geocode.mockReturnValue(
      new Promise<string | null>((resolve) => {
        late.resolve = resolve;
      })
    );
    const { result, unmount } = renderHook(() => useDeliveryLocation(true));
    act(() => grant());
    unmount();
    await act(async () => {
      late.resolve?.('06600');
      await Promise.resolve();
    });
    expect(result.current).toBeNull();
    expect(sessionStorage.getItem('yekora_delivery_place_v1')).toBeNull();
  });

  it('forgets the code when it stops being enabled, so an account with an address shows its own', () => {
    allow();
    sessionStorage.setItem('yekora_delivery_place_v1', '98000');
    const { result, rerender } = renderHook(
      ({ enabled }) => useDeliveryLocation(enabled),
      { initialProps: { enabled: true } }
    );
    expect(result.current).toBe('98000');
    rerender({ enabled: false });
    expect(result.current).toBeNull();
  });
});
