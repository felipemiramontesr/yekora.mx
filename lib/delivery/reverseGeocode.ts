/**
 * Turns the position of the browser into where the store delivers (FC 055 T2.6, T2.9, Enmienda 1),
 * straight from the browser: the coordinates go to the reverse-geocoding service and nowhere else,
 * never to YĒKORA's servers, and nothing here keeps them. BigDataCloud answers first (at its own
 * host, api-bdc.io: the old one redirects there and the CSP would block the hop); OpenStreetMap's
 * Nominatim is the fallback. The place is the five-digit postal code and, where neither service
 * knows one (the countryside), the Mexican state.
 *
 * @module
 */
import { asStateCode } from './stateAbbreviations';

/** A Mexican postal code: exactly five digits. */
const POSTAL_CODE = /^\d{5}$/;
const BIGDATACLOUD_URL = 'https://api-bdc.io/data/reverse-geocode-client';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';

/** A point on the earth, as the browser reports it. */
interface Coordinates {
  /** Degrees north (positive) or south. */
  latitude: number;
  /** Degrees east (positive) or west. */
  longitude: number;
}

/** What one service knew about a point: a postal code, a state of the list, or neither. */
interface Found {
  postalCode: string | null;
  state: string | null;
}

/** What `fetch` is for this module, injectable for tests. */
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const NOTHING: Found = { postalCode: null, state: null };

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
): Promise<Found> {
  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    localityLanguage: 'es',
  });
  const body = (await getJson(
    `${BIGDATACLOUD_URL}?${query.toString()}`,
    fetcher,
    signal
  )) as {
    postcode?: unknown;
    countryCode?: unknown;
    principalSubdivisionCode?: unknown;
  } | null;
  if (body === null) return NOTHING;
  return {
    postalCode: asPostalCode(body.postcode),
    state:
      body.countryCode === 'MX'
        ? asStateCode(body.principalSubdivisionCode)
        : null,
  };
}

async function fromNominatim(
  { latitude, longitude }: Coordinates,
  fetcher: Fetcher,
  signal: AbortSignal | undefined
): Promise<Found> {
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
  )) as {
    address?: {
      postcode?: unknown;
      country_code?: unknown;
      'ISO3166-2-lvl4'?: unknown;
    };
  } | null;
  const address = body?.address;
  if (address === undefined) return NOTHING;
  return {
    postalCode: asPostalCode(address.postcode),
    state:
      address.country_code === 'mx'
        ? asStateCode(address['ISO3166-2-lvl4'])
        : null,
  };
}

/**
 * Where the store delivers, for a position.
 *
 * @param coordinates - Where the browser says the person is.
 * @param signal - Cancels both requests, for example when the page goes away.
 * @param fetcher - `fetch`, injectable for tests.
 * @returns A five-digit postal code; failing that, the code of a Mexican state of the closed list
 *   (`ZAC`); or null when no service could name either.
 */
export async function placeOf(
  coordinates: Coordinates,
  signal?: AbortSignal,
  fetcher: Fetcher = (url, init) => fetch(url, init)
): Promise<string | null> {
  const first = await fromBigDataCloud(coordinates, fetcher, signal);
  if (first.postalCode !== null) return first.postalCode;
  const second = await fromNominatim(coordinates, fetcher, signal);
  return second.postalCode ?? first.state ?? second.state;
}
