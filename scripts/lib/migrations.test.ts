import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decide,
  formatCounters,
  isLocalHost,
  isYekoraDatabase,
  MIGRATION_NAME,
  migrationChecksum,
  pendingOrder,
  stepsToApply,
  verifyFileFor,
  type MigrationDecision,
} from './migrations';

describe('migration names', () => {
  it('accepts only the canonical scheme and orders by number', () => {
    expect(
      pendingOrder([
        '002_V0.4.1_FC009-F2_20261101_add_stock_index.sql',
        'seed_dev.sql',
        '001_down.sql',
        '001_V0.4.0_FC008-F1_20261018_create_catalog_schema.sql',
        '003_bad name.sql',
        '004_V0.5.0_FC010-F1_20261201_Upper.sql',
      ])
    ).toEqual([
      '001_V0.4.0_FC008-F1_20261018_create_catalog_schema.sql',
      '002_V0.4.1_FC009-F2_20261101_add_stock_index.sql',
    ]);
  });

  it('keeps every real migration of the repo canonical', () => {
    const sql = readdirSync('migrations').filter(
      (name) => name.endsWith('.sql') && !['seed_dev.sql'].includes(name)
    );
    // Rollbacks and verification counters (FC 015) sit next to their migration by number.
    const migrations = sql.filter(
      (name) => !name.endsWith('_down.sql') && !name.endsWith('_verify.sql')
    );
    expect(migrations.length).toBeGreaterThan(0);
    for (const name of migrations) expect(name).toMatch(MIGRATION_NAME);
  });
});

describe('checksums', () => {
  it('ignores CRLF vs LF, so Windows and Linux agree', () => {
    expect(migrationChecksum('SELECT 1;\r\nSELECT 2;\r\n')).toBe(
      migrationChecksum('SELECT 1;\nSELECT 2;\n')
    );
  });

  it('changes when the SQL changes', () => {
    expect(migrationChecksum('SELECT 1;')).not.toBe(
      migrationChecksum('SELECT 2;')
    );
    expect(migrationChecksum('')).toMatch(/^[0-9a-f]{64}$/);
  });
});

// T1.3 · R: an applied migration is skipped if unchanged and aborts the run if altered.
describe('decide (T1.3)', () => {
  it.each([
    ['abc', undefined, 'apply'],
    ['abc', 'abc', 'skip'],
    ['abc', 'def', 'tampered'],
  ] as const)(
    'checksum %s vs registry %s → %s',
    (checksum, registered, decision) => {
      expect(decide(checksum, registered)).toBe(decision);
    }
  );
});

describe('isLocalHost (dev data and rollbacks never reach production)', () => {
  it.each(['localhost', '127.0.0.1', '::1', ' LOCALHOST '])(
    '%s is local',
    (host) => {
      expect(isLocalHost(host)).toBe(true);
    }
  );
  it.each(['srv1234.hstgr.io', 'db.example.com', 'localhost.evil.com', ''])(
    '%s is not local',
    (host) => {
      expect(isLocalHost(host)).toBe(false);
    }
  );
});

describe('isYekoraDatabase (never touch other projects on a shared server)', () => {
  it.each([
    'yekora_dev',
    'yekora_restore',
    'yekora_prod_2026',
    // Hostinger prefixes every database with the account id.
    'u123456789_yekora',
    'u123456789_yekora_prod',
  ])('%s is Yekora', (name) => {
    expect(isYekoraDatabase(name)).toBe(true);
  });
  it.each([
    'archon',
    'dreamtek',
    'mysql',
    'yekora',
    'yekora_',
    'YEKORA_DEV',
    'yekora_dev; DROP',
    // Other projects on the same Hostinger account, or a malformed prefix.
    'u123456789_archon',
    'u123456789_yekora_',
    'u_yekora',
    'x123_yekora',
    'u123456789_yekoraprod',
  ])('%s is refused', (name) => {
    expect(isYekoraDatabase(name)).toBe(false);
  });
});

describe('stepsToApply (one named migration per production run, in order)', () => {
  const A = '001_V0.4.0_FC008-F1_20261018_create_catalog_schema.sql';
  const B = '002_V0.5.0_FC009-F1_20261101_add_orders.sql';
  const C = '003_V0.5.0_FC009-F2_20261102_add_payments.sql';
  const plan = (
    a: MigrationDecision,
    b: MigrationDecision,
    c: MigrationDecision
  ) => [
    { file: A, decision: a },
    { file: B, decision: b },
    { file: C, decision: c },
  ];

  it('applies every pending migration without a target (local development)', () => {
    expect(
      stepsToApply(plan('skip', 'apply', 'apply')).map((s) => s.file)
    ).toEqual([B, C]);
  });

  it('applies only the target when everything before it is applied', () => {
    expect(
      stepsToApply(plan('skip', 'apply', 'apply'), B).map((s) => s.file)
    ).toEqual([B]);
  });

  it('is a safe no-op when the target was already applied unchanged', () => {
    expect(stepsToApply(plan('skip', 'skip', 'apply'), B)).toEqual([]);
  });

  it('refuses a target while an earlier migration is pending', () => {
    expect(() => stepsToApply(plan('skip', 'apply', 'apply'), C)).toThrow(
      `apply ${B} first: migrations run in order`
    );
  });

  it('refuses a target that is not a migration of the folder', () => {
    expect(() =>
      stepsToApply(
        plan('skip', 'skip', 'skip'),
        '009_V9.9.9_FC999-F1_20991231_ghost.sql'
      )
    ).toThrow('is not a canonical migration in migrations/');
  });
});

describe('the dev seed', () => {
  it('only touches dev rows (fictitious SKUs)', () => {
    const seed = readFileSync('migrations/seed_dev.sql', 'utf8');
    const skus = [...seed.matchAll(/'(DEV-\d{4}|[A-Z]+-\d+)'/g)].map(
      (m) => m[1]
    );
    expect(skus.length).toBeGreaterThan(0);
    for (const sku of skus) expect(sku).toMatch(/^DEV-\d{4}$/);
  });
});

describe('verification counters (FC 015 §4)', () => {
  it('pairs each migration with NNN_verify.sql, like NNN_down.sql', () => {
    expect(
      verifyFileFor('003_V0.8.0_FC012-F0_20261021_orders_and_payments.sql')
    ).toBe('003_verify.sql');
  });

  it('prints one line of name=value pairs, in the order of the query', () => {
    expect(
      formatCounters('001_V0.4.0_FC008-F1_20261018_create_catalog_schema.sql', {
        disciplines: 5,
        levels: 4,
        products: '3',
      })
    ).toBe('[VERIFY] 001 disciplines=5 levels=4 products=3');
  });
});
