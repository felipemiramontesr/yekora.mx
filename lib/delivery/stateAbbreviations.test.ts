import { describe, expect, it } from 'vitest';
import { MEXICAN_STATES } from '@/lib/cart/mxStates';
import { abbreviationOf, asStateCode, STATE_CODES } from './stateAbbreviations';

describe('closed list of state abbreviations (FC 055 T2.9, 480_AN)', () => {
  it('has exactly the 32 states of the shipping selector, no more and no fewer', () => {
    expect([...STATE_CODES].sort()).toEqual(
      MEXICAN_STATES.map(({ code }) => code).sort()
    );
    expect(STATE_CODES).toHaveLength(32);
  });

  it('gives each state the abbreviation Ω approved, and none repeats', () => {
    const abbreviations = STATE_CODES.map(abbreviationOf);
    expect(new Set(abbreviations).size).toBe(32);
    expect(abbreviationOf('ZAC')).toBe('Zac.');
    expect(abbreviationOf('CMX')).toBe('CDMX');
    expect(abbreviationOf('MEX')).toBe('Edomex');
    expect(abbreviationOf('JAL')).toBe('Jal.');
    expect(abbreviationOf('ROO')).toBe('Q. Roo');
    expect(abbreviationOf('NLE')).toBe('NL');
  });

  it.each([
    ['MX-ZAC', 'ZAC'],
    ['ZAC', 'ZAC'],
    ['MX-CMX', 'CMX'],
    ['MX-XXX', null],
    ['US-TX', null],
    ['zac', null],
    ['', null],
    ['toString', null],
    [undefined, null],
    [32, null],
  ])('reads %j as %j', (value, expected) => {
    expect(asStateCode(value)).toBe(expected);
  });

  it('shows the code itself for a code that is not on the list, never throws', () => {
    expect(abbreviationOf('XXX')).toBe('XXX');
  });
});
