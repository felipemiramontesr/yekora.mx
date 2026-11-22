import { describe, expect, it } from 'vitest';
import { unsupportedLocale } from './language';

describe('unsupportedLocale (FC 067 T1.2)', () => {
  it.each([
    ['a body without the field', { other: 1 }, false],
    ['es-MX', { preferredLocale: 'es-MX' }, false],
    ['en', { preferredLocale: 'en' }, false],
    ['a language outside the catalog', { preferredLocale: 'fr' }, true],
    ['the wrong case', { preferredLocale: 'EN' }, true],
    ['a value that is not a string', { preferredLocale: 1 }, true],
    ['an explicit null', { preferredLocale: null }, true],
    ['no body at all', undefined, false],
    ['a null body', null, false],
    ['a body that is not an object', 'en', false],
  ])('%s → %s', (_case, body, expected) => {
    expect(unsupportedLocale(body, 'preferredLocale')).toBe(expected);
  });
});
