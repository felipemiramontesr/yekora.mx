import { describe, expect, it, vi } from 'vitest';
import { asPostalCode, postalCodeOf } from './reverseGeocode';

const POINT = { latitude: 19.4326, longitude: -99.1332 };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe('asPostalCode (FC 055 T2.7)', () => {
  it.each([
    ['06600', '06600'],
    [' 98000 ', '98000'],
    ['9800', null],
    ['980001', null],
    ['9800A', null],
    ['98000;98001', null],
    ['', null],
    [98000, null],
    [undefined, null],
    [null, null],
  ])('reads %j as %j', (value, expected) => {
    expect(asPostalCode(value)).toBe(expected);
  });
});

describe('postalCodeOf (FC 055 T2.6, Enmienda 1)', () => {
  it('asks BigDataCloud first, from the browser, with no credentials, and stops at a good answer', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ postcode: '06600' }));
    await expect(postalCodeOf(POINT, undefined, fetcher)).resolves.toBe(
      '06600'
    );
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://api.bigdatacloud.net/');
    expect(url).toContain('latitude=19.4326');
    expect(url).toContain('longitude=-99.1332');
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
  });

  it('falls back to Nominatim when BigDataCloud names no valid code', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ postcode: '' }))
      .mockResolvedValueOnce(json({ address: { postcode: '98000' } }));
    await expect(postalCodeOf(POINT, undefined, fetcher)).resolves.toBe(
      '98000'
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toContain(
      'https://nominatim.openstreetmap.org/reverse'
    );
  });

  it('falls back when BigDataCloud fails, answers an error or is not JSON', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(json({ address: { postcode: '77500' } }));
    await expect(postalCodeOf(POINT, undefined, fetcher)).resolves.toBe(
      '77500'
    );

    const refused = vi
      .fn()
      .mockResolvedValueOnce(json({}, 500))
      .mockResolvedValueOnce(new Response('not json'));
    await expect(postalCodeOf(POINT, undefined, refused)).resolves.toBeNull();
  });

  it('gives null when neither service names a five-digit code', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ postcode: 'ABCDE' }))
      .mockResolvedValueOnce(json({ address: {} }));
    await expect(postalCodeOf(POINT, undefined, fetcher)).resolves.toBeNull();
  });

  it('passes the cancel signal to every request', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockResolvedValue(json({}));
    await postalCodeOf(POINT, controller.signal, fetcher);
    for (const call of fetcher.mock.calls) {
      expect((call[1] as RequestInit).signal).toBe(controller.signal);
    }
  });

  it('uses the global fetch when none is injected', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(json({ postcode: '03100' }));
    await expect(postalCodeOf(POINT)).resolves.toBe('03100');
    spy.mockRestore();
  });
});
