import { describe, expect, it } from 'vitest';
import { MEXICAN_STATES } from './mxStates';
import { stateOfPostalCode } from './postalRanges';

describe('postal code to state (FC 047 T1.3)', () => {
  it.each([
    ['01000', 'CMX'],
    ['16999', 'CMX'],
    ['20000', 'AGU'],
    ['44100', 'JAL'],
    ['57999', 'MEX'],
    ['64000', 'NLE'],
    ['77500', 'ROO'],
    ['97000', 'YUC'],
    ['98612', 'ZAC'],
    ['99999', 'ZAC'],
  ])('%s belongs to %s', (postalCode, state) => {
    expect(stateOfPostalCode(postalCode)).toBe(state);
  });

  it('reaches every one of the 32 states and only them', () => {
    const reached = new Set<string>();
    for (let prefix = 0; prefix <= 99; prefix += 1) {
      const state = stateOfPostalCode(`${String(prefix).padStart(2, '0')}000`);
      if (state) reached.add(state);
    }
    expect([...reached].sort()).toEqual(
      MEXICAN_STATES.map((state) => state.code).sort()
    );
  });

  it('has no state for the unassigned blocks (00 and 17 to 19)', () => {
    for (const postalCode of ['00000', '17000', '18500', '19999']) {
      expect(stateOfPostalCode(postalCode)).toBeNull();
    }
  });

  it('refuses anything that is not exactly five digits', () => {
    for (const text of ['', '9861', '986123', 'abcde', '98 12']) {
      expect(stateOfPostalCode(text)).toBeNull();
    }
  });
});
