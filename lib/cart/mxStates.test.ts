import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEXICAN_STATES } from './mxStates';

/** The rows the shipping engine migration seeds into shipping_zones, in sort order. */
function migrationZones() {
  const file = readdirSync('migrations').find((name) =>
    /^002_V[\d.]+_FC011-F0_\d{8}_shipping_engine\.sql$/.test(name)
  );
  if (file === undefined) throw new Error('migration 002 not found');
  const sql = readFileSync(join('migrations', file), 'utf8');
  const insert = sql.slice(sql.indexOf('INSERT IGNORE INTO shipping_zones'));
  return [...insert.matchAll(/\('([A-Z]{3})', '([^']+)', '([^']+)', (\d+)\)/g)]
    .map(([, code, es, en, order]) => ({ code, es, en, order: Number(order) }))
    .sort((a, b) => a.order - b.order)
    .map(({ code, es, en }) => ({ code, es, en }));
}

describe('MEXICAN_STATES', () => {
  it('lists exactly the 32 zones of the migration: same codes, names and order', () => {
    expect(MEXICAN_STATES).toHaveLength(32);
    expect(MEXICAN_STATES).toEqual(migrationZones());
  });

  it('uses unique ISO 3166-2:MX codes of three capital letters', () => {
    const codes = MEXICAN_STATES.map((state) => state.code);
    expect(new Set(codes).size).toBe(32);
    expect(codes.every((code) => /^[A-Z]{3}$/.test(code))).toBe(true);
    expect(codes).toEqual(expect.arrayContaining(['CMX', 'MEX', 'ROO', 'ZAC']));
  });
});
