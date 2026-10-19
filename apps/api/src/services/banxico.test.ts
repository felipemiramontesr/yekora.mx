import { describe, expect, it, vi } from 'vitest';
import { fetchLatestFix, FIX_SERIES } from './banxico';

function answer(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

const payload = {
  bmx: {
    series: [
      {
        idSerie: 'SF43718',
        titulo: 'Tipo de cambio Pesos por dólar E.U.A.',
        datos: [{ fecha: '16/10/2026', dato: '18.5000' }],
      },
    ],
  },
};

describe('fetchLatestFix', () => {
  it('reads the latest FIX and converts the date to ISO', async () => {
    const fetchImpl = answer(payload);
    await expect(fetchLatestFix('t0k3n', fetchImpl)).resolves.toEqual({
      date: '2026-10-16',
      rate: '18.5000',
    });
    expect(FIX_SERIES).toBe('SF43718');
  });

  it('calls only the fixed Banxico URL, with the token header and a timeout', async () => {
    const fetchImpl = answer(payload);
    await fetchLatestFix('t0k3n', fetchImpl, 1500);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/oportuno'
    );
    expect(init.headers).toEqual({
      'Bmx-Token': 't0k3n',
      Accept: 'application/json',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('takes the last observation when several come back', async () => {
    const fetchImpl = answer({
      bmx: {
        series: [
          {
            idSerie: 'SF43718',
            datos: [
              { fecha: '15/10/2026', dato: '18.4000' },
              { fecha: '16/10/2026', dato: '18.5000' },
            ],
          },
        ],
      },
    });
    await expect(fetchLatestFix('t', fetchImpl)).resolves.toEqual({
      date: '2026-10-16',
      rate: '18.5000',
    });
  });

  it('fails on a non-2xx answer', async () => {
    await expect(fetchLatestFix('bad', answer({}, 401))).rejects.toThrow(
      'Banxico answered 401'
    );
  });

  it.each([
    ['an unpublished value', { fecha: '16/10/2026', dato: 'N/E' }],
    ['a malformed date', { fecha: '2026-10-16', dato: '18.5000' }],
  ])('rejects %s', async (_case, dato) => {
    const fetchImpl = answer({
      bmx: { series: [{ idSerie: 'SF43718', datos: [dato] }] },
    });
    await expect(fetchLatestFix('t', fetchImpl)).rejects.toThrow();
  });

  it('rejects another series', async () => {
    const fetchImpl = answer({
      bmx: {
        series: [
          {
            idSerie: 'SF60653',
            datos: [{ fecha: '16/10/2026', dato: '18.5' }],
          },
        ],
      },
    });
    await expect(fetchLatestFix('t', fetchImpl)).rejects.toThrow();
  });
});
