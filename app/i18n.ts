import en from '../messages/en.json';
import esMX from '../messages/es-MX.json';

// es-MX is the canonical dictionary; typing `en` against it makes a missing key a type error.
export type Messages = typeof esMX;

export const locales = ['es-MX', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'es-MX';

const dictionaries: Record<Locale, Messages> = { 'es-MX': esMX, en };

export function isLocale(value: string | undefined): value is Locale {
  return locales.includes(value as Locale);
}

export function getMessages(locale: Locale): Messages {
  return dictionaries[locale];
}

export const disciplines = [
  'senderismo',
  'montana',
  'escalada',
  'canonismo',
  'trail-running',
] as const;
export type Discipline = (typeof disciplines)[number];
