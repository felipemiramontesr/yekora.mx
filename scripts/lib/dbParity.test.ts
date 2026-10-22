import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatFingerprint,
  parityGate,
  parseCommand,
  parseExpected,
  sqlForDatabase,
  toFingerprint,
  workflowGate,
  workflowVerdict,
} from './dbParity';
import { MIGRATION_NAME, pendingOrder } from './migrations';

const ROOT = join(import.meta.dirname, '..', '..');
const SQL = readFileSync(
  join(ROOT, 'scripts', 'sql', 'schemaFingerprint.sql'),
  'utf8'
);
const LOCAL = { hash: '7fea8f9374537522137f59bd9ef53285', elements: 159 };
const OTHER = '93f1f66fbec9807fff0a2912a924fa65';

describe('T1.1 · SchemaParityVerificationGate(E, H, C), the 8 rows in order E → H → C', () => {
  it.each([
    ['⊤⊤⊤', { hash: LOCAL.hash, elements: 159 }, 'PARITY_100_MATCH', 0],
    ['⊤⊤⊥', { hash: LOCAL.hash, elements: 160 }, 'DRIFT_COUNT_MISMATCH', 1],
    ['⊤⊥⊤', { hash: OTHER, elements: 159 }, 'DRIFT_HASH_MISMATCH', 1],
    ['⊤⊥⊥', { hash: OTHER, elements: 160 }, 'DRIFT_HASH_MISMATCH', 1],
  ] as const)('E H C = %s → %s', (_row, expected, code, exitCode) => {
    expect(parityGate(LOCAL, expected)).toMatchObject({ code, exitCode });
  });

  it('E = ⊥ emits the fingerprint whatever H and C would be (rows ⊥··)', () => {
    expect(parityGate(LOCAL, undefined)).toEqual({
      code: 'FINGERPRINT_EMITTED',
      exitCode: 0,
      message: '7fea8f9374537522137f59bd9ef53285 (159 elementos)',
    });
  });

  it('with only the MD5 given, C is ⊤: the count cannot drift', () => {
    expect(parityGate(LOCAL, { hash: LOCAL.hash, elements: null })).toEqual({
      code: 'PARITY_100_MATCH',
      exitCode: 0,
      message:
        'PARITY: 100% MATCH — 7fea8f9374537522137f59bd9ef53285 (159 elementos)',
    });
    expect(parityGate(LOCAL, { hash: OTHER, elements: null }).message).toBe(
      `PARITY: DRIFT — local ${formatFingerprint(LOCAL)} ≠ expected ${OTHER}`
    );
  });

  it('says which side differs on a count drift', () => {
    expect(parityGate(LOCAL, { hash: LOCAL.hash, elements: 160 }).message).toBe(
      'PARITY: DRIFT — same MD5, but local has 159 elements and expected 160'
    );
    expect(parityGate(LOCAL, { hash: OTHER, elements: 160 }).message).toBe(
      `PARITY: DRIFT — local ${formatFingerprint(LOCAL)} ≠ expected ${OTHER} (160 elementos)`
    );
  });
});

describe('--expect, as copied from the workflow summary', () => {
  it('takes the long form, the short form, any case and surrounding spaces', () => {
    expect(
      parseExpected('7FEA8F9374537522137F59BD9EF53285 (159 elementos)')
    ).toEqual({
      hash: LOCAL.hash,
      elements: 159,
    });
    expect(parseExpected(`  ${LOCAL.hash}\n`)).toEqual({
      hash: LOCAL.hash,
      elements: null,
    });
  });

  it.each([
    '',
    'abc',
    `${LOCAL.hash}x`,
    `${LOCAL.hash} (159)`,
    `${LOCAL.hash} (-1 elementos)`,
  ])('refuses %j', (raw) => {
    expect(() => parseExpected(raw)).toThrow('--expect needs');
  });
});

describe('CLI arguments (--sql wins, offline)', () => {
  it('emits without arguments and compares with --expect', () => {
    expect(parseCommand([])).toEqual({ mode: 'emit' });
    expect(parseCommand(['--expect', `${LOCAL.hash} (159 elementos)`])).toEqual(
      {
        mode: 'expect',
        expected: { hash: LOCAL.hash, elements: 159 },
      }
    );
  });

  it('gives --sql precedence over --expect, in either order, without parsing it', () => {
    for (const args of [
      ['--expect', 'not-a-hash', '--sql', 'yekora_prod'],
      ['--sql', 'yekora_prod', '--expect'],
    ]) {
      expect(parseCommand(args)).toEqual({
        mode: 'sql',
        database: 'yekora_prod',
      });
    }
  });

  it.each([
    [['--sql'], '--sql needs a value'],
    [['--sql', '--expect', LOCAL.hash], '--sql needs a value'],
    [['--sql', 'yekora;DROP'], 'Invalid database name'],
    [['--expect'], '--expect needs a value'],
  ])('refuses %j', (args, message) => {
    expect(() => parseCommand(args)).toThrow(message);
  });
});

describe('the database answer', () => {
  it('reads the MD5 and the count as MariaDB returns them', () => {
    expect(toFingerprint({ fingerprint: LOCAL.hash, elements: '159' })).toEqual(
      LOCAL
    );
  });

  it.each([
    [
      'an empty schema (NULL MD5, 0 elements)',
      { fingerprint: null, elements: 0 },
    ],
    ['an uppercase or short hash', { fingerprint: 'ABC', elements: 1 }],
    [
      'a count that is not a whole number',
      { fingerprint: LOCAL.hash, elements: 'x' },
    ],
  ])('refuses %s', (_case, row) => {
    expect(() => toFingerprint(row)).toThrow('Unexpected fingerprint answer');
  });
});

describe('--sql <database> (paste into phpMyAdmin)', () => {
  it('binds the query to the named schema instead of DATABASE()', () => {
    const bound = sqlForDatabase(SQL, 'u123_yekora');
    expect(bound).toContain("SET @db := 'u123_yekora';");
    expect(bound).not.toContain('SET @db := DATABASE();');
    expect(
      bound.replace("SET @db := 'u123_yekora';", 'SET @db := DATABASE();')
    ).toBe(SQL);
  });

  it('refuses a name that could break out of the quotes, and a query without the binding', () => {
    expect(() => sqlForDatabase(SQL, "x'; DROP DATABASE y; --")).toThrow(
      'Invalid database name'
    );
    expect(() => sqlForDatabase('SELECT 1;', 'yekora')).toThrow(
      'does not bind the schema'
    );
  });
});

/** Every `FROM` / `JOIN` target of the fingerprint query. */
const sources = (sql: string) =>
  [...sql.matchAll(/\b(?:FROM|JOIN)\s+([\w.]+)/gi)].map((m) =>
    m[1].toLowerCase()
  );

/** The SELECT that builds one kind of element (from its prefix to the next UNION or the end). */
function elementSelect(kind: string): string {
  const start = SQL.indexOf(`'${kind}|'`);
  const end = SQL.indexOf('UNION ALL', start);
  return SQL.slice(start, end === -1 ? undefined : end).toLowerCase();
}

describe('T2 · invariants of schemaFingerprint.sql', () => {
  it('reads information_schema only: no user table, no data row (zero PII)', () => {
    const tables = sources(SQL).filter((name) => name !== 'elements');
    expect(tables.length).toBeGreaterThanOrEqual(7);
    expect(
      tables.filter((name) => !name.startsWith('information_schema.'))
    ).toEqual([]);
  });

  it('maps utf8_* collations to utf8mb3_* on tables and columns', () => {
    for (const kind of ['T', 'C']) {
      expect(elementSelect(kind)).toContain('replace(ifnull(');
      expect(elementSelect(kind)).toContain("'utf8_', 'utf8mb3_'");
    }
  });

  it('leaves ROW_FORMAT and AUTO_INCREMENT out of every table, whatever its collation', () => {
    expect(elementSelect('T')).not.toMatch(/row_format|auto_increment/);
  });

  it.each([
    ['T', ['table_name', 'table_type', 'engine', 'table_collation']],
    [
      'C',
      [
        'column_name',
        'ordinal_position',
        'column_type',
        'is_nullable',
        'column_default',
        'extra',
        'collation_name',
      ],
    ],
    ['V', ['column_name', 'ordinal_position']],
    ['D', ['view_definition']],
    [
      'I',
      [
        'index_name',
        'seq_in_index',
        'column_name',
        'non_unique',
        'collation',
        'sub_part',
      ],
    ],
    [
      'F',
      [
        'constraint_name',
        'column_name',
        'referenced_table_name',
        'referenced_column_name',
        'delete_rule',
        'update_rule',
      ],
    ],
    ['K', ['constraint_name', 'check_clause']],
  ])(
    'π: %s| projects %j, so a change in any of them changes the fingerprint',
    (kind, fields) => {
      const select = elementSelect(kind);
      expect(fields.filter((field) => !select.includes(field))).toEqual([]);
    }
  );

  it('normalizes CHECK clauses only by backticks and whitespace', () => {
    expect(elementSelect('K')).toContain(
      "trim(regexp_replace(replace(check_clause, '`', ''), '[[:space:]]+', ' '))"
    );
  });

  it('hashes the sorted elements with a fixed separator and reports their count', () => {
    expect(SQL).toContain(
      "MD5(GROUP_CONCAT(x ORDER BY x SEPARATOR '\\n')) AS fingerprint"
    );
    expect(SQL).toContain('COUNT(*) AS elements');
    expect(SQL).toContain('SET SESSION group_concat_max_len = 100000000;');
  });
});

describe('migrations/NNN_verify.sql (FC 015 §4)', () => {
  const files = readdirSync(join(ROOT, 'migrations'));
  const verifies = files.filter((name) => name.endsWith('_verify.sql'));

  it('exist for 001, 002 and 003 and are never applied as migrations', () => {
    expect(verifies.sort()).toEqual([
      '001_verify.sql',
      '002_verify.sql',
      '003_verify.sql',
    ]);
    expect(verifies.filter((name) => MIGRATION_NAME.test(name))).toEqual([]);
    expect(pendingOrder(verifies)).toEqual([]);
  });

  it('are one read-only SELECT of aggregates, never data rows', () => {
    for (const name of verifies) {
      const sql = readFileSync(join(ROOT, 'migrations', name), 'utf8')
        .replace(/^--.*$/gm, '')
        .trim();
      expect(sql.startsWith('SELECT')).toBe(true);
      expect(sql.match(/;/g)).toHaveLength(1);
      expect(sql).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|REPLACE|TRUNCATE)\b/i
      );
      // Every subquery is an aggregate: COUNT or SUM.
      const subqueries = [...sql.matchAll(/\(SELECT\s+(\w+)\(/gi)].map((m) =>
        m[1].toUpperCase()
      );
      const selects = sql.match(/\(SELECT/gi) ?? [];
      expect(subqueries).toHaveLength(selects.length);
      expect(
        subqueries.filter((fn) => fn !== 'COUNT' && fn !== 'IFNULL')
      ).toEqual([]);
    }
  });
});

describe('T1.2 · WorkflowFingerprintExecutionGate(M, P, B), the 8 rows in order M → P → B', () => {
  it.each([
    [true, true, true, 'FINGERPRINT_PUBLISHED'],
    [true, true, false, 'BACKUP_REQUIRED_FOR_APPLY'],
    [true, false, true, 'INVALID_MIGRATION_STATE'],
    [true, false, false, 'INVALID_MIGRATION_STATE'],
    [false, true, true, 'DB_CONNECTION_FAILED'],
    [false, true, false, 'DB_CONNECTION_FAILED'],
    [false, false, true, 'DB_CONNECTION_FAILED'],
    [false, false, false, 'DB_CONNECTION_FAILED'],
  ] as const)('M=%s P=%s B=%s → %s', (m, p, b, code) => {
    expect(workflowGate(m, p, b)).toBe(code);
  });
});

describe('T1.2 letters read from the migrate job', () => {
  const run = {
    connect: 'success',
    plan: 'success',
    decision: 'apply',
    backup: 'success',
    apply: 'success',
    fingerprint: 'success',
  };

  it.each([
    ['an apply that went well', {}, 'FINGERPRINT_PUBLISHED'],
    [
      'a skip (parity check, no backup needed)',
      { decision: 'skip', backup: 'skipped' },
      'FINGERPRINT_PUBLISHED',
    ],
    [
      'an apply whose backup failed',
      { backup: 'failure', apply: 'skipped' },
      'BACKUP_REQUIRED_FOR_APPLY',
    ],
    [
      'an edited or out-of-order migration',
      {
        plan: 'failure',
        decision: '',
        backup: 'skipped',
        apply: 'skipped',
        fingerprint: 'skipped',
      },
      'INVALID_MIGRATION_STATE',
    ],
    [
      'a failed DDL',
      { apply: 'failure', fingerprint: 'skipped' },
      'INVALID_MIGRATION_STATE',
    ],
    [
      'no connection',
      {
        connect: 'failure',
        plan: 'skipped',
        decision: '',
        backup: 'skipped',
        apply: 'skipped',
        fingerprint: 'skipped',
      },
      'DB_CONNECTION_FAILED',
    ],
    [
      'a fingerprint read that failed',
      { fingerprint: 'failure' },
      'DB_CONNECTION_FAILED',
    ],
  ])('%s → %s', (_case, over, code) => {
    expect(workflowVerdict({ ...run, ...over })).toBe(code);
  });
});
