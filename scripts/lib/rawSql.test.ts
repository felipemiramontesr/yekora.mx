import { describe, expect, it } from 'vitest';
import { ALLOWLIST, applyAllowlist, findRawSql } from './rawSql';

const check = (source: string) => findRawSql('module.ts', source);

// T1.1 · SafeQuery ⟺ L ∧ P ∧ C — the guard is L (static SQL text).
describe('findRawSql', () => {
  it('accepts static SQL with placeholders, in quotes or a plain template', () => {
    expect(
      check(`
        await db.query('SELECT * FROM products WHERE slug = ?', [slug]);
        await db.query("SELECT 1");
        await conn.execute(\`SELECT p.sku
          FROM products p WHERE p.id = ?\`, [id]);
        await pool.query('SELECT 1');
      `)
    ).toEqual([]);
  });

  it.each([
    [
      "db.query('SELECT * FROM t WHERE slug = ' + slug)",
      "'SELECT * FROM t WHERE slug = ' + slug",
    ],
    [
      'db.query(`SELECT * FROM t WHERE slug = ${slug}`)',
      '`SELECT * FROM t WHERE slug = ${slug}`',
    ],
    ['db.query(sql, [1])', 'sql'],
    ['db.execute(build())', 'build()'],
    ['db.query()', '(none)'],
  ])('rejects %s', (call, argument) => {
    expect(check(`async function f() { await ${call}; }`)).toEqual([
      { line: 1, argument },
    ]);
  });

  it('ignores other methods and comments that look like queries', () => {
    expect(
      check(`
        // db.query(sql)
        list.filter(sql);
        const text = 'db.query(sql)';
        query(sql);
      `)
    ).toEqual([]);
  });

  it('reports the line of each offending call', () => {
    const findings = check(
      ['ok();', "db.query('SELECT 1');", 'db.query(sql);'].join('\n')
    );
    expect(findings).toEqual([{ line: 3, argument: 'sql' }]);
  });
});

describe('applyAllowlist', () => {
  const ADAPTER = 'apps/api/src/services/db.ts';
  const entry = { file: ADAPTER, argument: 'sql', reason: 'adapter' };

  it('exempts the audited call and passes', () => {
    const findings = new Map([[ADAPTER, [{ line: 47, argument: 'sql' }]]]);
    expect(applyAllowlist(findings, [entry])).toEqual({
      violations: [],
      staleEntries: [],
    });
  });

  it('exempts one call per entry: a second identical call in the same file fails', () => {
    const findings = new Map([
      [
        ADAPTER,
        [
          { line: 47, argument: 'sql' },
          { line: 60, argument: 'sql' },
        ],
      ],
    ]);
    expect(applyAllowlist(findings, [entry]).violations).toEqual([
      `${ADAPTER}:60 sql`,
    ]);
  });

  it('does not exempt the same call in another file or with another argument', () => {
    const findings = new Map([
      ['apps/api/src/services/catalog.ts', [{ line: 9, argument: 'sql' }]],
      [ADAPTER, [{ line: 47, argument: 'query' }]],
    ]);
    expect(applyAllowlist(findings, [entry])).toEqual({
      violations: [
        'apps/api/src/services/catalog.ts:9 sql',
        `${ADAPTER}:47 query`,
      ],
      staleEntries: [entry],
    });
  });

  it('reports an entry that matches nothing as stale', () => {
    expect(applyAllowlist(new Map(), [entry])).toEqual({
      violations: [],
      staleEntries: [entry],
    });
  });

  it('keeps every audited exception justified', () => {
    for (const { file, argument, reason } of ALLOWLIST) {
      expect(file).toMatch(/^apps\/api\/src\/.+\.ts$/);
      expect(argument).not.toBe('');
      expect(reason).toMatch(/^FC \d{3}/);
    }
  });
});
