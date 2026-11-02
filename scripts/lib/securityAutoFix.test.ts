import { describe, expect, it } from 'vitest';
import {
  applyPatches,
  compareVersions,
  inRange,
  planFixes,
  type Release,
  vulnerableEntries,
} from './securityAutoFix';

// The four entries the 2026-11-01 audit flagged (252_AN), as bun.lock writes them.
const LOCK = [
  '{',
  '  "packages": {',
  '    "fast-uri": ["fast-uri@4.2.2", "", {}, "sha512-OLD42"],',
  '    "postcss-selector-parser": ["postcss-selector-parser@6.1.4", "", { "dependencies": { "cssesc": "^3.0.0" } }, "sha512-OLDPSP"],',
  '    "eslint-plugin-sonarjs/minimatch": ["minimatch@10.2.6", "", {}, "sha512-OLDMM"],',
  '    "ajv-formats/ajv/fast-uri": ["fast-uri@3.1.8", "", {}, "sha512-OLD31"],',
  '    "@scope/safe": ["@scope/safe@1.0.0", "", {}, "sha512-SAFE"],',
  '    "unaudited": ["unaudited@2.0.0", "", {}, "sha512-NONE"],',
  '  }',
  '}',
].join('\n');

const RANGES = {
  'fast-uri': ['>=4.0.0 <4.2.3', '>=3.0.0 <3.1.9'],
  'postcss-selector-parser': ['<6.1.5'],
  minimatch: ['<11.0.1'],
  '@scope/safe': ['<0.5.0'],
};

const release = (integrity: string, dependencies = {}): Release => ({
  integrity,
  dependencies,
});

const REGISTRY: Record<string, Record<string, Release>> = {
  'fast-uri': {
    '3.1.8': release('sha512-OLD31'),
    '3.1.9': release('sha512-NEW319'),
    '4.2.2': release('sha512-OLD42'),
    '4.2.3': release('sha512-NEW423'),
    '5.0.0-beta.1': release('sha512-BETA'),
  },
  'postcss-selector-parser': {
    '6.1.4': release('sha512-OLDPSP', { cssesc: '^3.0.0' }),
    '6.1.5': release('sha512-NEWPSP', { cssesc: '^3.0.0' }),
    '7.1.7': release('sha512-SEVEN', { cssesc: '^3.0.0' }),
  },
  minimatch: {
    '10.2.6': release('sha512-OLDMM'),
    '11.0.3': release('sha512-ELEVEN', { 'brace-expansion': '^5.0.0' }),
  },
};
const registry = async (name: string) => REGISTRY[name] ?? {};

describe('version ranges (as bun audit writes them)', () => {
  it('orders versions numerically, ignoring a prerelease tag', () => {
    expect(
      ['4.10.0', '4.2.3', '4.2.10', 'v4.2.2'].sort(compareVersions)
    ).toEqual(['v4.2.2', '4.2.3', '4.2.10', '4.10.0']);
  });

  it('reads and-ranges, or-ranges and bare versions', () => {
    expect(inRange('4.2.2', '>=4.0.0 <4.2.3')).toBe(true);
    expect(inRange('4.2.3', '>=4.0.0 <4.2.3')).toBe(false);
    expect(inRange('3.1.8', '>=4.0.0 <4.2.3 || >=3.0.0 <3.1.9')).toBe(true);
    expect(inRange('1.0.0', '1.0.0')).toBe(true);
    expect(inRange('1.0.0', '=1.0.0')).toBe(true);
    expect(inRange('1.0.1', '>1.0.0 <=1.0.1')).toBe(true);
  });
});

describe('vulnerableEntries', () => {
  it('finds every locked copy an advisory covers, nested ones included', () => {
    expect(vulnerableEntries(LOCK, RANGES)).toEqual([
      { key: 'fast-uri', name: 'fast-uri', version: '4.2.2' },
      {
        key: 'postcss-selector-parser',
        name: 'postcss-selector-parser',
        version: '6.1.4',
      },
      {
        key: 'eslint-plugin-sonarjs/minimatch',
        name: 'minimatch',
        version: '10.2.6',
      },
      { key: 'ajv-formats/ajv/fast-uri', name: 'fast-uri', version: '3.1.8' },
    ]);
  });
});

describe('planFixes (FC 036 T2.2: only patches are automatic)', () => {
  it('plans patches inside the same minor, and holds a major jump for Ω', async () => {
    const plans = await planFixes(
      vulnerableEntries(LOCK, RANGES),
      RANGES,
      registry
    );
    expect(plans.map((p) => [p.key, p.to, p.level])).toEqual([
      ['fast-uri', '4.2.3', 'patch'],
      ['postcss-selector-parser', '6.1.5', 'patch'],
      ['eslint-plugin-sonarjs/minimatch', '11.0.3', 'major'],
      ['ajv-formats/ajv/fast-uri', '3.1.9', 'patch'],
    ]);
    expect(plans[0].integrity).toBe('sha512-NEW423');
    expect(plans[2].integrity).toBeUndefined();
  });

  it('classifies a fix in a later minor of the same major as minor (Ω approves)', async () => {
    const plans = await planFixes(
      [{ key: 'p', name: 'p', version: '2.1.0' }],
      { p: ['<2.2.0'] },
      async () => ({ '2.1.0': release('a'), '2.2.0': release('b') })
    );
    expect(plans[0]).toMatchObject({ to: '2.2.0', level: 'minor' });
  });

  it('holds a patch that brings new dependencies, or whose current release is unknown', async () => {
    const changed = await planFixes(
      [{ key: 'p', name: 'p', version: '1.0.0' }],
      { p: ['<1.0.1'] },
      async () => ({
        '1.0.0': release('a'),
        '1.0.1': release('b', { 'new-dep': '^1.0.0' }),
      })
    );
    expect(changed[0]).toMatchObject({ to: '1.0.1', level: 'minor' });
    expect(changed[0].blockedBy).toMatch(/same dependencies/);
    const unknown = await planFixes(
      [{ key: 'p', name: 'p', version: '1.0.0' }],
      { p: ['<1.0.1'] },
      async () => ({ '1.0.1': release('b') })
    );
    expect(unknown[0].level).toBe('minor');
  });

  it('says none when no published release escapes the advisory', async () => {
    const plans = await planFixes(
      [{ key: 'p', name: 'p', version: '1.0.0' }],
      {},
      async () => ({})
    );
    expect(plans[0]).toMatchObject({ to: null, level: 'none' });
  });
});

describe('applyPatches', () => {
  it('rewrites only version and integrity of the patched entries', async () => {
    const plans = await planFixes(
      vulnerableEntries(LOCK, RANGES),
      RANGES,
      registry
    );
    const next = applyPatches(LOCK, plans);
    expect(next).toContain(
      '"fast-uri": ["fast-uri@4.2.3", "", {}, "sha512-NEW423"]'
    );
    expect(next).toContain(
      '"ajv-formats/ajv/fast-uri": ["fast-uri@3.1.9", "", {}, "sha512-NEW319"]'
    );
    expect(next).toContain(
      '"postcss-selector-parser": ["postcss-selector-parser@6.1.5", "", { "dependencies": { "cssesc": "^3.0.0" } }, "sha512-NEWPSP"]'
    );
    expect(next).toContain('"minimatch@10.2.6", "", {}, "sha512-OLDMM"');
    expect(next.split('\n')).toHaveLength(LOCK.split('\n').length);
  });
});
