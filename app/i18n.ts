/**
 * Dictionaries and language set of the storefront (es-MX canonical, en translated in house).
 *
 * Texts live in `messages/*.json`, never in components. FC 005 invariant I-AntiPending: no
 * dictionary may carry a pending marker or a draft notice (components/legal/antiPending.test.ts).
 *
 * @module
 */
import en from '../messages/en.json';
import esMX from '../messages/es-MX.json';

/**
 * Shape of every dictionary. es-MX is the canonical one; typing `en` against it turns a
 * missing or renamed key into a type error.
 */
export type Messages = typeof esMX;

/** Languages the site is published in, Spanish first. */
export const locales = ['es-MX', 'en'] as const;

/** One of the published languages. */
export type Locale = (typeof locales)[number];

/** Language of the root URLs (`/`) and of `x-default` in hreflang. */
export const defaultLocale: Locale = 'es-MX';

const dictionaries: Record<Locale, Messages> = { 'es-MX': esMX, en };

/**
 * Dictionary of a language. Resolved at build time: the export is static HTML.
 *
 * @param locale - Language to read.
 * @returns All texts of the site in that language.
 */
export function getMessages(locale: Locale): Messages {
  return dictionaries[locale];
}

/**
 * The five disciplines, in menu order. Each slug is a stable id: dictionary key, pictogram
 * key (components/icons/DisciplineIcon) and anchor on the home page (`/#escalada`).
 */
export const disciplines = [
  'senderismo',
  'montana',
  'escalada',
  'canonismo',
  'trail-running',
] as const;

/** Slug of one discipline. */
export type Discipline = (typeof disciplines)[number];

/**
 * Whether a slug is one of the five disciplines. Catalog references come from the database
 * (ADR 0007), so a discipline added there later is valid data without a pictogram of its own.
 *
 * @param slug - Discipline slug from the catalog.
 */
export function isDiscipline(slug: string): slug is Discipline {
  return (disciplines as readonly string[]).includes(slug);
}
