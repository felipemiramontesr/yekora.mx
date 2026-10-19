import { describe, expect, it, vi } from 'vitest';
import type { Db } from './db';
import { currentRate } from './exchangeRate';

const NOW = new Date('2026-10-17T18:00:00Z');
const HOUR = 60 * 60 * 1000;

/** In-memory exchange_rates table behind the Db port; records every statement. */
function fakeDb(rows: { date: string; rate: string; fetchedAt: Date }[]) {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const db: Db = {
    async query<Row>(sql: string, params: readonly unknown[] = []) {
      calls.push({ sql, params });
      if (sql.startsWith('INSERT')) {
        const [, date, rate, fetchedAt] = params as [
          string,
          string,
          string,
          Date,
        ];
        rows.push({ date, rate, fetchedAt });
        return [] as Row[];
      }
      const latest = [...rows].sort((a, b) => b.date.localeCompare(a.date))[0];
      return (
        latest
          ? [
              {
                determination_date: latest.date,
                rate_decimal: latest.rate,
                fetched_at: latest.fetchedAt,
              },
            ]
          : []
      ) as Row[];
    },
    ping: async () => undefined,
    close: async () => undefined,
  };
  return { db, calls };
}

describe('currentRate', () => {
  it('serves the stored FIX without calling Banxico when there is no token', async () => {
    const { db } = fakeDb([
      { date: '2026-10-16', rate: '18.5000', fetchedAt: new Date(0) },
    ]);
    const fetchFix = vi.fn();
    await expect(currentRate(db, undefined, NOW, fetchFix)).resolves.toEqual({
      series: 'SF43718',
      date: '2026-10-16',
      rate: '18.5000',
    });
    expect(fetchFix).not.toHaveBeenCalled();
  });

  it('does not call Banxico again within the hour', async () => {
    const { db } = fakeDb([
      {
        date: '2026-10-16',
        rate: '18.5000',
        fetchedAt: new Date(NOW.getTime() - HOUR / 2),
      },
    ]);
    const fetchFix = vi.fn();
    await currentRate(db, 'token', NOW, fetchFix);
    expect(fetchFix).not.toHaveBeenCalled();
  });

  it('refreshes a stale FIX from Banxico and stores it with parameters', async () => {
    const { db, calls } = fakeDb([
      {
        date: '2026-10-15',
        rate: '18.4000',
        fetchedAt: new Date(NOW.getTime() - 2 * HOUR),
      },
    ]);
    const fetchFix = vi.fn(async () => ({
      date: '2026-10-16',
      rate: '18.5000',
    }));
    await expect(
      currentRate(db, 'token', NOW, fetchFix)
    ).resolves.toMatchObject({
      date: '2026-10-16',
      rate: '18.5000',
    });
    expect(fetchFix).toHaveBeenCalledWith('token');
    const insert = calls.find((call) => call.sql.startsWith('INSERT'));
    expect(insert?.params).toEqual(['SF43718', '2026-10-16', '18.5000', NOW]);
  });

  it('fetches the first FIX when none is stored', async () => {
    const { db } = fakeDb([]);
    const fetchFix = vi.fn(async () => ({
      date: '2026-10-16',
      rate: '18.5000',
    }));
    await expect(
      currentRate(db, 'token', NOW, fetchFix)
    ).resolves.toMatchObject({
      rate: '18.5000',
    });
  });

  it('keeps serving the last stored FIX when Banxico fails', async () => {
    const { db } = fakeDb([
      {
        date: '2026-10-15',
        rate: '18.4000',
        fetchedAt: new Date(NOW.getTime() - 2 * HOUR),
      },
    ]);
    const fetchFix = vi.fn(async () => {
      throw new Error('timeout');
    });
    await expect(
      currentRate(db, 'token', NOW, fetchFix)
    ).resolves.toMatchObject({
      date: '2026-10-15',
      rate: '18.4000',
    });
  });

  it('returns null when no FIX was ever stored and none can be fetched', async () => {
    const { db } = fakeDb([]);
    await expect(currentRate(db, undefined, NOW)).resolves.toBeNull();
  });

  it('uses the real clock and Banxico client by default', async () => {
    const { db } = fakeDb([
      { date: '2026-10-16', rate: '18.5000', fetchedAt: new Date() },
    ]);
    await expect(currentRate(db, 'token')).resolves.toMatchObject({
      rate: '18.5000',
    });
  });
});
