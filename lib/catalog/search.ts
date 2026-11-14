/**
 * Product search of the header (FC 047 T0.2, T1.2): a minimal index of the catalog, built with the
 * site, and the matching that runs in the browser over it. The index carries only what a
 * suggestion shows (name, slug, discipline): no prices, no stock, nothing personal.
 *
 * @module
 */
import type { Product } from '@/lib/api/catalogClient';

/** One product of the search index. */
export interface SearchEntry {
  /** Product slug: the page is `<catalog>/<slug>/`. */
  slug: string;
  /** Name of the product, in the language of the index. */
  name: string;
  /** Discipline slug. */
  discipline: string;
  /** Name of the discipline, in the language of the index. */
  disciplineName: string;
}

/**
 * The index of a catalog.
 *
 * @param products - The products of one language.
 * @returns One entry per product, in the same order.
 */
export function searchIndexOf(products: readonly Product[]): SearchEntry[] {
  return products.map(({ slug, name, discipline, disciplineName }) => ({
    slug,
    name,
    discipline,
    disciplineName,
  }));
}

/**
 * Text as it is compared: lower case and without accents, so «montana» finds «Montaña».
 *
 * @param text - As written.
 */
function normalizeText(text: string): string {
  return text.normalize('NFD').replaceAll(/\p{M}/gu, '').toLowerCase().trim();
}

/**
 * How well an entry answers a query: 0 when the name starts with it, 1 when a word of the name
 * does, 2 when it is somewhere in the name or the discipline; null when some word of the query is
 * nowhere (every word must be found).
 */
function rank(entry: SearchEntry, words: readonly string[]): number | null {
  const name = normalizeText(entry.name);
  const haystack = `${name} ${normalizeText(entry.disciplineName)}`;
  if (!words.every((word) => haystack.includes(word))) return null;
  const query = words.join(' ');
  if (name.startsWith(query)) return 0;
  return name.split(/\s+/u).some((part) => part.startsWith(words[0])) ? 1 : 2;
}

/**
 * The entries that answer a query, best first.
 *
 * @param entries - The index.
 * @param query - What the person typed.
 * @param limit - The most entries to give back; all of them when omitted.
 * @returns Nothing for an empty query; otherwise the entries, ordered by how well they answer and
 *   then by name.
 */
export function matchEntries(
  entries: readonly SearchEntry[],
  query: string,
  limit = Number.POSITIVE_INFINITY
): SearchEntry[] {
  const words = normalizeText(query).split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [];
  return entries
    .flatMap((entry) => {
      const score = rank(entry, words);
      return score === null ? [] : [{ entry, score }];
    })
    .sort(
      (a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name)
    )
    .slice(0, limit)
    .map(({ entry }) => entry);
}
