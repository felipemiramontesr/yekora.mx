import { describe, expect, it, vi } from 'vitest';
import { asPostalCode, placeOf } from './reverseGeocode';

const POINT = { latitude: 19.4326, longitude: -99.1332 };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const COUNTRYSIDE = {
  postcode: '',
  countryCode: 'MX',
  principalSubdivisionCode: 'MX-ZAC',
};

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

describe('placeOf (FC 055 T2.6, T2.9, Enmienda 1)', () => {
  it('asks BigDataCloud first, at its own host, from the browser, with no credentials, and stops at a postal code', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ postcode: '06600' }));
    await expect(placeOf(POINT, undefined, fetcher)).resolves.toBe('06600');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://api-bdc.io/');
    expect(url).toContain('latitude=19.4326');
    expect(url).toContain('longitude=-99.1332');
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
  });

  it('falls back to Nominatim for the postal code when BigDataCloud names none', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json(COUNTRYSIDE))
      .mockResolvedValueOnce(json({ address: { postcode: '98000' } }));
    await expect(placeOf(POINT, undefined, fetcher)).resolves.toBe('98000');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toContain(
      'https://nominatim.openstreetmap.org/reverse'
    );
  });

  it('gives the state of BigDataCloud when no service knows a postal code (the countryside)', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json(COUNTRYSIDE))
      .mockResolvedValueOnce(json({ address: {} }));
    await expect(placeOf(POINT, undefined, fetcher)).resolves.toBe('ZAC');
  });

  it('gives the state of Nominatim when BigDataCloud fails and neither knows a postal code', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(
        json({
          address: { country_code: 'mx', 'ISO3166-2-lvl4': 'MX-JAL' },
        })
      );
    await expect(placeOf(POINT, undefined, fetcher)).resolves.toBe('JAL');
  });

  it('never gives a state outside Mexico or off the closed list', async () => {
    const abroad = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          ...COUNTRYSIDE,
          countryCode: 'US',
          principalSubdivisionCode: 'US-TX',
        })
      )
      .mockResolvedValueOnce(
        json({ address: { country_code: 'us', 'ISO3166-2-lvl4': 'US-TX' } })
      );
    await expect(placeOf(POINT, undefined, abroad)).resolves.toBeNull();

    const unknown = vi
      .fn()
      .mockResolvedValueOnce(
        json({ ...COUNTRYSIDE, principalSubdivisionCode: 'MX-XXX' })
      )
      .mockResolvedValueOnce(
        json({ address: { country_code: 'mx', 'ISO3166-2-lvl4': 'MX-ZZZ' } })
      );
    await expect(placeOf(POINT, undefined, unknown)).resolves.toBeNull();
  });

  it('prefers a postal code of the second service over the state of the first', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json(COUNTRYSIDE))
      .mockResolvedValueOnce(
        json({
          address: {
            postcode: '77500',
            country_code: 'mx',
            'ISO3166-2-lvl4': 'MX-ROO',
          },
        })
      );
    await expect(placeOf(POINT, undefined, fetcher)).resolves.toBe('77500');
  });

  it('falls back when BigDataCloud answers an error or is not JSON, and gives null when nothing is known', async () => {
    const refused = vi
      .fn()
      .mockResolvedValueOnce(json({}, 500))
      .mockResolvedValueOnce(new Response('not json'));
    await expect(placeOf(POINT, undefined, refused)).resolves.toBeNull();

    const nothing = vi
      .fn()
      .mockResolvedValueOnce(json({ postcode: 'ABCDE' }))
      .mockResolvedValueOnce(json({ address: { postcode: 'x' } }));
    await expect(placeOf(POINT, undefined, nothing)).resolves.toBeNull();
  });

  it('passes the cancel signal to every request', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockResolvedValue(json({}));
    await placeOf(POINT, controller.signal, fetcher);
    for (const call of fetcher.mock.calls) {
      expect((call[1] as RequestInit).signal).toBe(controller.signal);
    }
  });

  it('uses the global fetch when none is injected', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(json({ postcode: '03100' }));
    await expect(placeOf(POINT)).resolves.toBe('03100');
    spy.mockRestore();
  });
});
