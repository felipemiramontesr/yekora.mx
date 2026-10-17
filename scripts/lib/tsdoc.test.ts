import { describe, expect, it } from 'vitest';
import { checkTsDoc } from './tsdoc';

const check = (source: string, options = {}) =>
  checkTsDoc('module.tsx', source, options);

describe('checkTsDoc · T (every export documented)', () => {
  it('passes documented functions, components, types, interfaces and constants', () => {
    const report = check(`
      /** Adds. @param a - Left. @param b - Right. @returns The sum. */
      export function add(a: number, b: number) { return a + b; }
      /** Greeting card. @param name - Who to greet. */
      export function Card({ name }: { name: string }) { return <p>{name}</p>; }
      /** Supported locales. */
      export const locales = ['es-MX', 'en'] as const;
      /** A locale. */
      export type Locale = (typeof locales)[number];
      /** Card props. */
      export interface Props { name: string }
    `);
    expect(report).toEqual({ checked: 5, findings: [] });
  });

  it('reports each undocumented export with its line (Scenario 2)', () => {
    const report = check(
      [
        '/** Fine. */',
        'export const a = 1;',
        'export const b = 2;',
        'export function c() {}',
      ].join('\n')
    );
    expect(report.checked).toBe(3);
    expect(report.findings).toEqual([
      { name: 'b', line: 3, reason: 'missing TSDoc block' },
      { name: 'c', line: 4, reason: 'missing TSDoc block' },
    ]);
  });

  it('ignores line comments and non-exported code', () => {
    const report = check(`
      // Not a doc block.
      export const a = 1;
      function helper() {}
      const local = 2;
    `);
    expect(report.findings).toEqual([
      { name: 'a', line: 3, reason: 'missing TSDoc block' },
    ]);
  });

  it('skips framework contracts of App Router files', () => {
    const source = `
      export const metadata = {};
      export default function Page() { return null; }
    `;
    expect(
      check(source, {
        frameworkFile: true,
        frameworkExports: new Set(['metadata']),
      })
    ).toEqual({ checked: 0, findings: [] });
    expect(check(source).findings.map((f) => f.name)).toEqual([
      'metadata',
      'default',
    ]);
  });
});

describe('checkTsDoc · C (well-formed blocks)', () => {
  it.each([
    ['/** */ export const a = 1;', 'empty TSDoc block'],
    [
      '/** @remarks Only tags. */ export const a = 1;',
      'TSDoc block has tags but no summary',
    ],
    ['/** Summary. @foo bar */ export const a = 1;', 'unknown tag @foo'],
    [
      '/** Summary. @returns */ export function a() { return 1; }',
      '@returns without text',
    ],
    [
      '/** Summary. @param x */ export function a(x: number) { return x; }',
      '@param without text',
    ],
    [
      '/** Summary. @param y - Wrong. */ export function a(x: number) { return x; }',
      '@param y does not match a parameter',
    ],
  ])('rejects %s', (source, reason) => {
    expect(check(source).findings[0]?.reason).toBe(reason);
  });

  it('accepts @param for destructured props and arrow functions', () => {
    const report = check(`
      /** View. @param locale - Page language. */
      export const View = ({ locale }: { locale: string }) => locale;
    `);
    expect(report.findings).toEqual([]);
  });

  it('does not accept @param on something that is not a function', () => {
    expect(
      check('/** Value. @param x - Nope. */ export const a = 1;').findings[0]
        ?.reason
    ).toBe('@param x does not match a parameter');
  });

  it('names anonymous default exports "default"', () => {
    expect(check('export default function () {}').findings).toEqual([
      { name: 'default', line: 1, reason: 'missing TSDoc block' },
    ]);
  });
});
