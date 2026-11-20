/**
 * Turns the position of the browser into a Mexican postal code (FC 055 T2.6, Enmienda 1), straight
 * from the browser: the coordinates go to the reverse-geocoding service and nowhere else, never to
 * YĒKORA's servers, and nothing here keeps them. BigDataCloud answers first; OpenStreetMap's
 * Nominatim is the fallback when it fails or has no five-digit code for that spot.
 *
 * @module
 */

/** A Mexican postal code: exactly five digits. */
const POSTAL_CODE = /^\d{5}$/;
const BIGDATACLOUD_URL =
  'https://api.bigdatacloud.net/data/reverse-geocode-client';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';

/** A point on the earth, as the browser reports it. */
interface Coordinates {
  /** Degrees north (positive) or south. */
  latitude: number;
  /** Degrees east (positive) or west. */
  longitude: number;
}

/** What `fetch` is for this module, injectable for tests. */
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Keeps a value only when it is a well-formed postal code.
 *
 * @param value - Whatever the service answered in its postal-code field.
 * @returns The five digits, or null.
 */
export function asPostalCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim();
  return POSTAL_CODE.test(code) ? code : null;
}

async function getJson(
  url: string,
  fetcher: Fetcher,
  signal: AbortSignal | undefined
): Promise<unknown> {
  try {
    const response = await fetcher(url, {
      signal,
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    return response.ok ? ((await response.json()) as unknown) : null;
  } catch {
    return null; // offline, blocked, timed out or not JSON: the caller falls back or stays silent
  }
}

async function fromBigDataCloud(
  { latitude, longitude }: Coordinates,
  fetcher: Fetcher,
  signal: AbortSignal | undefined
): Promise<string | null> {
  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    localityLanguage: 'es',
  });
  const body = (await getJson(
    `${BIGDATACLOUD_URL}?${query.toString()}`,
    fetcher,
    signal
  )) as { postcode?: unknown } | null;
  return asPostalCode(body?.postcode);
}

async function fromNominatim(
  { latitude, longitude }: Coordinates,
  fetcher: Fetcher,
  signal: AbortSignal | undefined
): Promise<string | null> {
  const query = new URLSearchParams({
    format: 'jsonv2',
    addressdetails: '1',
    zoom: '18',
    lat: String(latitude),
    lon: String(longitude),
  });
  const body = (await getJson(
    `${NOMINATIM_URL}?${query.toString()}`,
    fetcher,
    signal
  )) as { address?: { postcode?: unknown } } | null;
  return asPostalCode(body?.address?.postcode);
}

/**
 * The postal code of a position.
 *
 * @param coordinates - Where the browser says the person is.
 * @param signal - Cancels both requests, for example when the page goes away.
 * @param fetcher - `fetch`, injectable for tests.
 * @returns The five-digit postal code, or null when no service could name one.
 */
export async function postalCodeOf(
  coordinates: Coordinates,
  signal?: AbortSignal,
  fetcher: Fetcher = (url, init) => fetch(url, init)
): Promise<string | null> {
  const first = await fromBigDataCloud(coordinates, fetcher, signal);
  return first ?? fromNominatim(coordinates, fetcher, signal);
}
