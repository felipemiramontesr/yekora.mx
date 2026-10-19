import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findEnumTypes } from './noEnum';

// T1.4 · ScalableDomain ⟺ ¬E ∧ R: the detector is E.
describe('findEnumTypes', () => {
  it('finds ENUM and SET column types with their line, in any case', () => {
    const sql = [
      'CREATE TABLE t (',
      "  status ENUM('a', 'b') NOT NULL,",
      "  flags set ('x'),",
      "  level enum('1')",
      ');',
    ].join('\n');
    expect(findEnumTypes(sql)).toEqual([
      { line: 2, type: 'ENUM' },
      { line: 3, type: 'set' },
      { line: 4, type: 'enum' },
    ]);
  });

  it('ignores comments and quoted data that only mention them', () => {
    const sql = [
      '-- No ENUM( here (ADR 0007)',
      '# nor SET( here',
      '/* ENUM(a) */',
      'INSERT INTO t (note) VALUES (\'ENUM(x) is forbidden\'), ("SET(y)");',
      'UPDATE t SET note = 1;',
      'CREATE TABLE `enum(` (id INT);',
    ].join('\n');
    expect(findEnumTypes(sql)).toEqual([]);
  });

  it('handles escapes, doubled quotes, apostrophes in comments and unclosed text', () => {
    const sql = [
      "INSERT INTO t VALUES ('it''s ENUM(', 'a\\'b SET(');",
      "-- it's a comment",
      "ALTER TABLE t ADD c ENUM('x');",
      '/* never closed ENUM(',
    ].join('\n');
    expect(findEnumTypes(sql)).toEqual([{ line: 3, type: 'ENUM' }]);
    expect(findEnumTypes("SELECT 'unclosed SET(")).toEqual([]);
    expect(findEnumTypes('# last line ENUM(')).toEqual([]);
  });

  it('keeps every migration of the repo free of ENUM/SET (ADR 0007)', () => {
    const files = readdirSync('migrations').filter((name) =>
      name.endsWith('.sql')
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(
        findEnumTypes(readFileSync(`migrations/${file}`, 'utf8')),
        file
      ).toEqual([]);
    }
  });
});
