/**
 * Banxico SIE client (FC 008): latest FIX, series SF43718 (pesos per 1 USD).
 *
 * SSRF-safe by construction (OWASP A10): the only URL is a constant on Banxico's host, and nothing
 * from a request ever reaches it, so there is no input that could redirect the call elsewhere.
 * The token goes in the `Bmx-Token` header and is never logged. Requests time out, so a slow
 * Banxico can never hold an API response.
 *
 * @module
 */
import { z } from 'zod';

/** The only host this module may contact. */
const BANXICO_HOST = 'www.banxico.org.mx';
/** Latest ("oportuno") value of the FIX series. */
const FIX_URL = `https://${BANXICO_HOST}/SieAPIRest/service/v1/series/SF43718/datos/oportuno`;
/** Banxico series of the FIX. */
export const FIX_SERIES = 'SF43718';

const response = z.object({
  bmx: z.object({
    series: z
      .array(
        z.object({
          idSerie: z.literal(FIX_SERIES),
          datos: z
            .array(
              z.object({
                fecha: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
                dato: z.string().regex(/^\d+(\.\d+)?$/),
              })
            )
            .min(1),
        })
      )
      .length(1),
  }),
});

/** One FIX observation. */
export interface FixRate {
  /** Determination date, ISO `YYYY-MM-DD`. */
  date: string;
  /** Pesos per 1 USD, as published (decimal string, e.g. `18.5000`). */
  rate: string;
}

/**
 * Fetches the latest FIX from Banxico.
 *
 * @param token - Banxico SIE token (`BANXICO_TOKEN`).
 * @param fetchImpl - `fetch`, injectable for tests.
 * @param timeoutMs - Abort after this many milliseconds.
 * @returns The latest FIX with its determination date.
 * @throws On a timeout, a non-2xx answer or an unexpected payload.
 */
export async function fetchLatestFix(
  token: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 3000
): Promise<FixRate> {
  const answer = await fetchImpl(FIX_URL, {
    headers: { 'Bmx-Token': token, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!answer.ok) throw new Error(`Banxico answered ${answer.status}`);
  const { bmx } = response.parse(await answer.json());
  const latest = bmx.series[0].datos.at(-1)!;
  const [day, month, year] = latest.fecha.split('/');
  return { date: `${year}-${month}-${day}`, rate: latest.dato };
}
