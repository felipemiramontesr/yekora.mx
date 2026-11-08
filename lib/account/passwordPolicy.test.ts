import { describe, expect, it } from 'vitest';
import { PASSWORD_PROBLEMS, passwordViolation } from './passwordPolicy';

const ANA = { email: 'ana.karen@example.test', fullName: 'Ana Karen Peña' };
const NOBODY = { email: '', fullName: '' };
/** Meets every rule: 16 characters, all four classes, nothing personal or common. */
const STRONG = 'Ruta-Nevado7#Sur';
/** The bounds of the contract: 12 to 128 characters. */
const PASSWORD_MAX = 128;

describe('passwordViolation (FC 042 T1.2, T2.6)', () => {
  it.each([
    ['accepts a strong password', STRONG, null],
    ['refuses 11 characters', 'Ruta-Neva7#', 'length'],
    ['refuses more than 128', `${STRONG}${'x'.repeat(PASSWORD_MAX)}`, 'length'],
    ['refuses no upper case', 'ruta-nevado7#sur', 'uppercase'],
    ['refuses no lower case', 'RUTA-NEVADO7#SUR', 'lowercase'],
    ['refuses no digit', 'Ruta-Nevado#Sur', 'digit'],
    ['refuses no symbol', 'RutaNevado7Sur', 'symbol'],
    ['refuses the part of the e-mail before @', 'Ana.Karen-2026!', 'personal'],
    [
      'refuses a word of the name, accents aside',
      'MiCasaPena#2026',
      'personal',
    ],
    ['refuses Password123!', 'Password123!x', 'common'],
    ['refuses Qwerty123456!', 'Qwerty123456!', 'common'],
    ['refuses its l33t spelling', 'P@ssw0rd2026!', 'common'],
    ['refuses a word of the site', 'Yekora#2026ab', 'common'],
    ['refuses too few different characters', 'Aa1!Aa1!Aa1!', 'common'],
  ])('%s', (_case, password, rule) => {
    expect(passwordViolation(password, ANA)).toBe(rule);
  });

  it('accepts a common word inside a longer phrase', () => {
    expect(passwordViolation('MiPassword-DeMontaña7', NOBODY)).toBeNull();
  });

  it('ignores short name parts and an unknown context', () => {
    // Parts of fewer than 3 letters («ox», «Li») would refuse half of all passwords: ignored.
    expect(
      passwordViolation('Ruta-Nevado7#Ox', {
        email: 'ox@a.test',
        fullName: 'Ox Li',
      })
    ).toBeNull();
    expect(
      passwordViolation(STRONG, { email: 'a@b.test', fullName: 'Al Yu' })
    ).toBeNull();
    expect(passwordViolation(STRONG, NOBODY)).toBeNull();
  });

  it('keeps the bounds of the contract', () => {
    // Exactly 128 characters still passes; one more is the length rule.
    const longest = STRONG.repeat(8);
    expect(longest).toHaveLength(PASSWORD_MAX);
    expect(passwordViolation(longest, NOBODY)).toBeNull();
    expect(passwordViolation(`${longest}x`, NOBODY)).toBe('length');
  });
});

describe('the rules in order and their codes', () => {
  it('reports the first rule broken, from the length down to common', () => {
    expect(passwordViolation('', NOBODY)).toBe('length');
    expect(passwordViolation('a'.repeat(12), NOBODY)).toBe('uppercase');
    expect(passwordViolation('A'.repeat(12), NOBODY)).toBe('lowercase');
  });

  it('counts accented letters, and any other character as a symbol', () => {
    expect(passwordViolation('ÑANDÚ-ñandú-cumbre', NOBODY)).toBe('digit');
    expect(passwordViolation('Cumbre del sol 7', NOBODY)).toBeNull();
  });

  it('names every rule with its API code', () => {
    expect(Object.values(PASSWORD_PROBLEMS)).toEqual([
      'PASSWORD_LENGTH',
      'PASSWORD_UPPERCASE',
      'PASSWORD_LOWERCASE',
      'PASSWORD_DIGIT',
      'PASSWORD_SYMBOL',
      'PASSWORD_PERSONAL',
      'PASSWORD_COMMON',
    ]);
  });
});
