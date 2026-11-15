import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALLOWLIST,
  checkGuidedFields,
  FIELD_MODULE,
  staleEntries,
} from './guidedFields';
import { isTestFile, walk } from './sourceFiles';

const check = (source: string) => checkGuidedFields('x.tsx', source);

// T1.2 · CiGuidedFieldGatePassed ⟺ F ∧ D ∧ S.
describe('checkGuidedFields (F: every control draws from a Field)', () => {
  it('accepts a control that spreads the control of its Field', () => {
    const report = check(
      'const A = () => <Field>{(control) => <input {...control} name="a" />}</Field>;'
    );
    expect(report).toEqual({ controls: 1, unguided: [], duplicates: [] });
  });

  it('flags an input, a select and a textarea that do not, with their line', () => {
    const report = check(
      [
        'const A = () => (',
        '  <form>',
        '    <input name="a" />',
        '    <select name="b"><option /></select>',
        '    <textarea name="c" />',
        '  </form>',
        ');',
      ].join('\n')
    );
    expect(report.controls).toBe(3);
    expect(report.unguided).toEqual([
      { code: 'UNGUIDED_FORM_CONTROL', line: 3, name: 'input' },
      { code: 'UNGUIDED_FORM_CONTROL', line: 4, name: 'select' },
      { code: 'UNGUIDED_FORM_CONTROL', line: 5, name: 'textarea' },
    ]);
  });

  it('does not ask a Field of what is not typed text: checkbox, radio, range, search', () => {
    const report = check(
      [
        'const A = () => (',
        '  <>',
        '    <input type="checkbox" />',
        '    <input type="radio" />',
        '    <input type="range" />',
        '    <input type="search" />',
        '  </>',
        ');',
      ].join('\n')
    );
    expect(report.controls).toBe(4);
    expect(report.unguided).toEqual([]);
  });

  it('asks a Field of every other type, even when the type is not a literal', () => {
    const report = check(
      [
        'const A = ({ shown }) => (',
        '  <>',
        '    <input type="email" />',
        '    <input type={shown ? "text" : "password"} />',
        '    <input type="file" />',
        '    <input />',
        '    <input type="text" role="combobox" />',
        '  </>',
        ');',
      ].join('\n')
    );
    expect(report.unguided.map((finding) => finding.line)).toEqual([
      3, 4, 5, 6, 7,
    ]);
  });

  it('does not take any other spread for the control of a Field', () => {
    const report = check(
      'const A = (props) => <input {...props} {...rest} />;'
    );
    expect(report.unguided).toHaveLength(1);
  });

  it('ignores the elements that are not form controls', () => {
    const report = check(
      'const A = () => <div><button type="submit" /></div>;'
    );
    expect(report).toEqual({ controls: 0, unguided: [], duplicates: [] });
  });
});

describe('checkGuidedFields (D: one Field component)', () => {
  it.each([
    ['a function', 'function Field() { return null; }'],
    ['an arrow function', 'const Field = () => null;'],
    ['a class', 'class Field {}'],
  ])('flags a second Field declared as %s', (_case, source) => {
    expect(check(source).duplicates).toEqual([
      { code: 'DUPLICATE_FIELD_DEFINITION', line: 1, name: 'Field' },
    ]);
  });

  it('does not take for a second Field what only imports or names one like it', () => {
    const report = check(
      [
        "import { Field } from './ui/Field';",
        'function PanelField() { return <Field />; }',
        'const TextField = () => null;',
      ].join('\n')
    );
    expect(report.duplicates).toEqual([]);
  });
});

describe('staleEntries (S: the allowlist stays true)', () => {
  it('names the entries whose module no longer holds an unguided control', () => {
    const unguided = new Map([
      ['a.tsx', 2],
      ['b.tsx', 0],
    ]);
    expect(staleEntries(['a.tsx', 'b.tsx', 'c.tsx'], unguided)).toEqual([
      'b.tsx',
      'c.tsx',
    ]);
    expect(staleEntries(['a.tsx'], unguided)).toEqual([]);
  });
});

// T2.4 · every non-test module of components/ passes the gate, and the allowlist is exact.
describe('the components of the site (FC 050 T2.4)', () => {
  const root = process.cwd();
  const modules = walk(join(root, 'components'))
    .filter((file) => file.endsWith('.tsx') && !isTestFile(file))
    .map((file) => ({
      path: relative(root, file).split(sep).join('/'),
      report: checkGuidedFields(file, readFileSync(file, 'utf8')),
    }));

  it('reads the components', () => {
    expect(modules.length).toBeGreaterThan(20);
    expect(modules.some((module) => module.path === FIELD_MODULE)).toBe(true);
  });

  it('has no control outside a Field, but the audited allowlist', () => {
    const unguided = modules
      .filter((module) => !ALLOWLIST.includes(module.path))
      .flatMap((module) =>
        module.report.unguided.map(
          (finding) => `${module.path}:${finding.line} ${finding.name}`
        )
      );
    expect(unguided).toEqual([]);
  });

  it('declares no other Field than the one of components/ui', () => {
    const others = modules
      .filter((module) => module.path !== FIELD_MODULE)
      .flatMap((module) =>
        module.report.duplicates.map(
          (finding) => `${module.path}:${finding.line}`
        )
      );
    expect(others).toEqual([]);
  });

  it('keeps no stale entry in the allowlist', () => {
    const unguidedBy = new Map(
      modules.map((module) => [module.path, module.report.unguided.length])
    );
    expect(staleEntries(ALLOWLIST, unguidedBy)).toEqual([]);
  });
});
