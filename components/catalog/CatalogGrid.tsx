'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Locale, Messages } from '@/app/i18n';
import { fill, type PriceText } from '@/lib/catalog/format';
import { matchEntries } from '@/lib/catalog/search';
import { ProductVisual } from './ProductVisual';

/** A product card, prepared on the server (prices already formatted). */
export interface GridItem {
  /** Product slug, React key. */
  slug: string;
  /** Product page in this language. */
  href: string;
  /** Product name. */
  name: string;
  /** Discipline slug (filter value) and its localized name. */
  discipline: string;
  disciplineName: string;
  /** Experience level slug (filter value) and its localized name. */
  level: string;
  levelName: string;
  /** Price in MXN cents, for sorting. */
  priceMxnCents: number;
  /** Formatted prices. */
  price: PriceText;
  /** Whether it can be bought now. */
  inStock: boolean;
  /** First photo, or null for the pictogram. */
  image: { path: string; alt: string } | null;
}

/** Props of {@link CatalogGrid}. */
interface CatalogGridProps {
  /** Language of the page (name sorting and plural rules). */
  locale: Locale;
  /** Every product of the catalog. */
  items: GridItem[];
  /** `catalog` texts of the page's language. */
  messages: Messages['catalog'];
}

type Sort = 'name' | 'price_asc' | 'price_desc';

/** Distinct values of a reference across the items, sorted by their localized name. */
function optionsOf(
  items: GridItem[],
  slugOf: (item: GridItem) => string,
  nameOf: (item: GridItem) => string,
  locale: Locale
): { slug: string; name: string }[] {
  const names = new Map(items.map((item) => [slugOf(item), nameOf(item)]));
  return [...names]
    .map(([slug, name]) => ({ slug, name }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

function comparator(sort: Sort, locale: Locale) {
  if (sort === 'price_asc') {
    return (a: GridItem, b: GridItem) => a.priceMxnCents - b.priceMxnCents;
  }
  if (sort === 'price_desc') {
    return (a: GridItem, b: GridItem) => b.priceMxnCents - a.priceMxnCents;
  }
  return (a: GridItem, b: GridItem) => a.name.localeCompare(b.name, locale);
}

// A labelled select. The label points at the select (htmlFor) instead of wrapping it, so the
// accessible name is exactly the label, not the label plus the selected option.
function Filter({
  label,
  value,
  onChange,
  disabled,
  children,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  children: ReactNode;
}>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1 text-sm font-semibold">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 rounded-md border border-petroleo/30 bg-white px-3 font-normal text-petroleo"
      >
        {children}
      </select>
    </div>
  );
}

/**
 * Reads the filters the address carries (FC 047 T2.1, T1.2): `?disciplina=` from the strip of
 * disciplines and `?q=` from the search of the header. It renders nothing, so while the page is
 * still the static HTML the full catalog is what shows; once the address is known it hands the
 * filters up, and again whenever the address changes (the strip links are client navigations).
 */
function UrlFilters({
  onChange,
}: Readonly<{
  onChange: (filters: { discipline: string; query: string }) => void;
}>) {
  const params = useSearchParams();
  const discipline = params?.get('disciplina') ?? '';
  const query = params?.get('q') ?? '';
  const seen = useRef(false);
  useEffect(() => {
    // This renders after hydration, maybe after the person has already chosen something: an
    // address with no filter says nothing about it, so only a filter, or the end of one, counts.
    const first = !seen.current;
    seen.current = true;
    if (first && discipline === '' && query === '') return;
    onChange({ discipline, query });
  }, [discipline, query, onChange]);
  return null;
}

function ProductCard({
  item,
  messages,
}: Readonly<{ item: GridItem; messages: Messages['catalog'] }>) {
  return (
    <Link
      href={item.href}
      className="group flex h-full flex-col gap-4 rounded-xl border border-petroleo/15 bg-white/60 p-4 hover:border-petroleo/40"
    >
      <ProductVisual image={item.image} discipline={item.discipline} />
      <div className="flex flex-1 flex-col gap-2">
        <p className="text-xs uppercase tracking-wider text-petroleo/80">
          {item.disciplineName} · {item.levelName}
        </p>
        <h2 className="text-lg font-semibold group-hover:underline">
          {item.name}
        </h2>
        <p className="mt-auto text-lg font-semibold">
          {item.price.mxn}{' '}
          <span className="text-xs font-normal text-petroleo/80">
            {messages.price.vatIncluded}
          </span>
        </p>
        {item.price.usd && (
          <p className="text-sm text-petroleo/80">
            {fill(messages.price.usdReference, { usd: item.price.usd })}
          </p>
        )}
        <p className="text-sm">
          {item.inStock
            ? messages.product.inStock
            : messages.product.outOfStock}
        </p>
      </div>
    </Link>
  );
}

/**
 * The catalog grid with its filters (discipline, level) and sort. Filtering runs in the browser
 * over the prerendered catalog, so the static export needs no page per filter; without
 * JavaScript the full catalog still shows. Filter options come from the products themselves,
 * so a level added in the database (ADR 0007) appears without a code change.
 *
 * FC 035 (256_AN): the selects stay disabled until React has hydrated them. A choice made on the
 * static HTML before that would be reset to the initial state and lost, so it cannot be made.
 */
export function CatalogGrid({
  locale,
  items,
  messages,
}: Readonly<CatalogGridProps>) {
  const [discipline, setDiscipline] = useState('');
  const [level, setLevel] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);
  const { filters } = messages;

  const disciplineOptions = useMemo(
    () =>
      optionsOf(
        items,
        (item) => item.discipline,
        (item) => item.disciplineName,
        locale
      ),
    [items, locale]
  );
  const levelOptions = useMemo(
    () =>
      optionsOf(
        items,
        (item) => item.level,
        (item) => item.levelName,
        locale
      ),
    [items, locale]
  );
  // The slugs that answer the search of the header, or null when there is none.
  const found = useMemo(
    () =>
      query.trim() === ''
        ? null
        : new Set(matchEntries(items, query).map((entry) => entry.slug)),
    [items, query]
  );
  const visible = useMemo(
    () =>
      items
        .filter(
          (item) =>
            (discipline === '' || item.discipline === discipline) &&
            (level === '' || item.level === level) &&
            (found === null || found.has(item.slug))
        )
        .sort(comparator(sort, locale)),
    [items, discipline, level, found, sort, locale]
  );
  const plural = new Intl.PluralRules(locale).select(visible.length);

  // Stable, so the address is read again only when it changes, never after a choice of the person.
  const setFilters = useCallback(
    (next: { discipline: string; query: string }) => {
      setDiscipline(next.discipline);
      setQuery(next.query);
    },
    []
  );

  return (
    <>
      <Suspense fallback={null}>
        <UrlFilters onChange={setFilters} />
      </Suspense>
      <fieldset className="mt-8 grid gap-4 sm:grid-cols-3">
        <legend className="sr-only">{filters.label}</legend>
        <Filter
          label={filters.discipline}
          value={discipline}
          onChange={setDiscipline}
          disabled={!isMounted}
        >
          <option value="">{filters.allDisciplines}</option>
          {disciplineOptions.map((option) => (
            <option key={option.slug} value={option.slug}>
              {option.name}
            </option>
          ))}
        </Filter>
        <Filter
          label={filters.level}
          value={level}
          onChange={setLevel}
          disabled={!isMounted}
        >
          <option value="">{filters.allLevels}</option>
          {levelOptions.map((option) => (
            <option key={option.slug} value={option.slug}>
              {option.name}
            </option>
          ))}
        </Filter>
        <Filter
          label={filters.sort}
          value={sort}
          onChange={(value) => setSort(value as Sort)}
          disabled={!isMounted}
        >
          <option value="name">{filters.sortName}</option>
          <option value="price_asc">{filters.sortPriceAsc}</option>
          <option value="price_desc">{filters.sortPriceDesc}</option>
        </Filter>
      </fieldset>

      {/* <output> carries the status role natively, so the count is announced when it changes. */}
      <output className="mt-6 block text-sm text-petroleo/80">
        {query.trim() !== '' &&
          `${fill(filters.searching, { query: query.trim() })} · `}
        {fill(plural === 'one' ? filters.results.one : filters.results.other, {
          count: visible.length,
        })}
      </output>
      {query.trim() !== '' && (
        <button
          type="button"
          onClick={() => {
            // Drops `?q=` from the address too, so a reload does not bring the search back.
            globalThis.history.replaceState(
              null,
              '',
              globalThis.location.pathname
            );
            setQuery('');
          }}
          className="tap-target mt-2 text-sm underline underline-offset-4"
        >
          {filters.clearSearch}
        </button>
      )}

      {visible.length === 0 ? (
        <div className="mt-6 flex flex-col items-start gap-4">
          <p>{filters.empty}</p>
          <button
            type="button"
            onClick={() => {
              setDiscipline('');
              setLevel('');
              setQuery('');
            }}
            className="min-h-11 rounded-md border border-petroleo px-5 font-semibold"
          >
            {filters.reset}
          </button>
        </div>
      ) : (
        <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((item) => (
            <li key={item.slug}>
              <ProductCard item={item} messages={messages} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
