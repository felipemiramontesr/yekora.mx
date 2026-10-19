/**
 * Catalog snapshot (FC 008 F3): the catalog a static export is built from.
 *
 * scripts/buildCatalog.ts writes `.catalog/snapshot.json` before `next build` (from the API, from
 * the E2E fixture, or empty) and the catalog pages read it while prerendering. Reading one
 * validated file, instead of calling the API from each page, keeps the build deterministic and
 * free of Next's persistent fetch cache. A missing file is an empty catalog: the state of
 * production until the backoffice (K-07) loads products, and of `next dev`.
 *
 * @module
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Locale } from '@/app/i18n';
import {
  exchangeRateSchema,
  productSchema,
  type LocaleCatalog,
  type Product,
} from '@/lib/api/catalogClient';

/** Snapshot path, relative to the project root. Git-ignored: it is a build input, not source. */
export const SNAPSHOT_FILE = join('.catalog', 'snapshot.json');

/**
 * Slug of the one placeholder page an empty catalog prerenders. Next's static export refuses a
 * dynamic route with zero params, so `[slug]` gets this one, which renders a 404 and is deleted
 * from out/ after the build (scripts/pruneCatalogPlaceholder.ts). Underscores make it impossible
 * as a real slug: the API only accepts `[a-z0-9-]`.
 */
export const PLACEHOLDER_SLUG = '__none__';

const snapshotSchema = z
  .object({
    exchangeRate: exchangeRateSchema.nullable(),
    products: z.object({
      'es-MX': z.array(productSchema),
      en: z.array(productSchema),
    }),
  })
  // Each product page links its translation (hreflang): both languages must list the same slugs.
  .refine(
    ({ products }) => slugList(products['es-MX']) === slugList(products.en),
    { message: 'es-MX and en must list the same products' }
  );

/** Slugs of a product list in a stable order, to compare two languages regardless of order. */
function slugList(products: readonly { slug: string }[]): string {
  return products
    .map((product) => product.slug)
    .sort((a, b) => a.localeCompare(b))
    .join();
}

/** The catalog of both languages and the FIX of its USD reference. */
export type CatalogSnapshot = z.infer<typeof snapshotSchema>;

/** Catalog with no products and no FIX ("Próximamente"). */
export const EMPTY_SNAPSHOT: CatalogSnapshot = {
  exchangeRate: null,
  products: { 'es-MX': [], en: [] },
};

/**
 * Validates a snapshot.
 *
 * @param data - Parsed JSON.
 * @returns The snapshot, typed.
 * @throws When it breaks the contract or the languages disagree on the products.
 */
export function parseSnapshot(data: unknown): CatalogSnapshot {
  return snapshotSchema.parse(data);
}

/**
 * Joins the two languages read from the API into one snapshot.
 *
 * @param es - Spanish catalog.
 * @param en - English catalog.
 * @returns The validated snapshot; the FIX is the Spanish read's (both come from one API).
 */
export function snapshotFrom(
  es: LocaleCatalog,
  en: LocaleCatalog
): CatalogSnapshot {
  return parseSnapshot({
    exchangeRate: es.exchangeRate,
    products: { 'es-MX': es.products, en: en.products },
  });
}

/**
 * Reads the snapshot the build was prepared with.
 *
 * @param file - Absolute path; defaults to {@link SNAPSHOT_FILE} under the working directory.
 * @returns The snapshot, or {@link EMPTY_SNAPSHOT} when no file exists.
 * @throws When the file exists but is not a valid snapshot (never silently empty).
 */
export function loadSnapshot(
  file: string = join(process.cwd(), SNAPSHOT_FILE)
): CatalogSnapshot {
  if (!existsSync(file)) return EMPTY_SNAPSHOT;
  return parseSnapshot(JSON.parse(readFileSync(file, 'utf8')));
}

/**
 * Params of the product pages of one language.
 *
 * @param snapshot - Catalog snapshot.
 * @param locale - Language of the route.
 * @returns One entry per product, or only {@link PLACEHOLDER_SLUG} when the catalog is empty.
 */
export function productParams(
  snapshot: CatalogSnapshot,
  locale: Locale
): { slug: string }[] {
  const slugs = snapshot.products[locale].map(({ slug }) => ({ slug }));
  return slugs.length > 0 ? slugs : [{ slug: PLACEHOLDER_SLUG }];
}

/**
 * One product of the snapshot.
 *
 * @param snapshot - Catalog snapshot.
 * @param locale - Language of the page.
 * @param slug - Product slug.
 * @returns The product, or undefined (the placeholder or an unknown slug).
 */
export function findProduct(
  snapshot: CatalogSnapshot,
  locale: Locale,
  slug: string
): Product | undefined {
  return snapshot.products[locale].find((product) => product.slug === slug);
}
