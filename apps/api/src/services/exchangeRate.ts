/**
 * Current FIX with a database cache (FC 008).
 *
 * Banxico publishes the FIX once per banking day (from 12:00), so the API stores each value in
 * `exchange_rates` and asks Banxico again at most once per {@link REFRESH_MS}. If Banxico is
 * slow, down or the token is missing, the last stored FIX keeps being served with its date. If
 * there is none, the catalog shows prices in MXN only.
 *
 * @module
 */
import { fetchLatestFix, FIX_SERIES, type FixRate } from './banxico';
import type { Db } from './db';

/** Minimum time between two Banxico calls. */
const REFRESH_MS = 60 * 60 * 1000;

/** FIX as the API serves it. */
export interface CurrentRate {
  /** Banxico series (SF43718). */
  series: string;
  /** Determination date, `YYYY-MM-DD`. */
  date: string;
  /** Pesos per 1 USD, decimal string with 4 decimals. */
  rate: string;
}

interface RateRow {
  determination_date: string;
  rate_decimal: string;
  fetched_at: Date;
}

/** Fetches the latest FIX from Banxico (injectable for tests). */
type FixFetcher = (token: string) => Promise<FixRate>;

async function latestStored(db: Db): Promise<RateRow | undefined> {
  const [row] = await db.query<RateRow>(
    "SELECT DATE_FORMAT(determination_date, '%Y-%m-%d') AS determination_date, rate_decimal, fetched_at FROM exchange_rates WHERE series_id = ? ORDER BY determination_date DESC LIMIT 1",
    [FIX_SERIES]
  );
  return row;
}

/**
 * Latest FIX, refreshed from Banxico when the stored one is older than {@link REFRESH_MS}.
 *
 * @param db - Database port.
 * @param token - Banxico token; without it nothing is fetched.
 * @param now - Current time (injectable for tests).
 * @param fetchFix - Banxico client (injectable for tests).
 * @returns The FIX to use, or null when none has ever been stored.
 */
export async function currentRate(
  db: Db,
  token: string | undefined,
  now: Date = new Date(),
  fetchFix: FixFetcher = fetchLatestFix
): Promise<CurrentRate | null> {
  let row = await latestStored(db);
  const stale =
    !row || now.getTime() - new Date(row.fetched_at).getTime() > REFRESH_MS;
  if (token && stale) {
    try {
      const fix = await fetchFix(token);
      await db.query(
        'INSERT INTO exchange_rates (series_id, determination_date, rate_decimal, fetched_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE rate_decimal = VALUES(rate_decimal), fetched_at = VALUES(fetched_at)',
        [FIX_SERIES, fix.date, fix.rate, now]
      );
      row = await latestStored(db);
    } catch {
      // Banxico unavailable: keep serving the last stored FIX (degraded, never failing).
    }
  }
  return row
    ? {
        series: FIX_SERIES,
        date: row.determination_date,
        rate: String(row.rate_decimal),
      }
    : null;
}
