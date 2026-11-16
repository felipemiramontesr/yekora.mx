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
import { isDiscipline, type Locale, type Messages } from '@/app/i18n';
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
  /** Name of its brand, or null: the search finds a product by it too. */
  brandName: string | null;
  /** Its properties (FC 048): the filterable ones become filters of the grid. */
  properties: readonly GridProperty[];
  /** Price in MXN cents, for sorting. */
  priceMxnCents: number;
  /** Formatted prices. */
  price: PriceText;
  /** Whether it can be bought now. */
  inStock: boolean;
  /** First photo, or null for the pictogram. */
  image: { path: string; alt: string } | null;
}

/** One property of a product, as the page shows it. */
interface GridProperty {
  groupCode: string;
  groupName: string;
  valueCode: string;
  valueName: string;
  isFilterable: boolean;
}

/** A filter built from the properties the products really carry (FC 048 T1.2). */
interface PropertyFilter {
  /** Code of the group of properties. */
  code: string;
  /** Its name, in the language of the page. */
  name: string;
  /** The values some product has, sorted by name. */
  values: { code: string; name: string }[];
}

/**
 * The filters of the properties: one per filterable group some product has, in the order the
 * products give them (the store's), each with only the values present. A group or a value added
 * in the console shows up with no change to the code (ADR 0007).
 */
function propertyFilters(items: readonly GridItem[], locale: Locale) {
  const groups = new Map<
    string,
    { name: string; values: Map<string, string> }
  >();
  for (const item of items) {
    for (const property of item.properties) {
      if (!property.isFilterable) continue;
      const group = groups.get(property.groupCode) ?? {
        name: property.groupName,
        values: new Map<string, string>(),
      };
      group.values.set(property.valueCode, property.valueName);
      groups.set(property.groupCode, group);
    }
  }
  return [...groups].map(([code, group]): PropertyFilter => ({
    code,
    name: group.name,
    values: [...group.values]
      .map(([valueCode, name]) => ({ code: valueCode, name }))
      .sort((a, b) => a.name.localeCompare(b.name, locale)),
  }));
}

/** Props of {@link CatalogGrid}. */
interface CatalogGridProps {
  /** Language of the page (name sorting and plural rules). */
  locale: Locale;
  /** Every product of the catalog. */
  items: GridItem[];
  /** `catalog` texts of the page's language. */
  messages: Messages['catalog'];
  /** The names of the disciplines in the page's language (for a discipline with no products yet). */
  disciplineNames: Messages['disciplines'];
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
  // A slug that is not one of the disciplines is ignored: the whole catalog shows (FC 052 T1.2).
  const asked = params?.get('disciplina') ?? '';
  const discipline = isDiscipline(asked) ? asked : '';
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
          {item.disciplineName}
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
 * The catalog grid with its filters (discipline) and sort. Filtering runs in the browser
 * over the prerendered catalog, so the static export needs no page per filter; without
 * JavaScript the full catalog still shows. Filter options come from the products themselves,
 * so a discipline added in the database (ADR 0007) appears without a code change.
 *
 * FC 035 (256_AN): the selects stay disabled until React has hydrated them. A choice made on the
 * static HTML before that would be reset to the initial state and lost, so it cannot be made.
 */
export function CatalogGrid({
  locale,
  items,
  messages,
  disciplineNames,
}: Readonly<CatalogGridProps>) {
  const [discipline, setDiscipline] = useState('');
  const [query, setQuery] = useState('');
  // The value chosen in each property filter, by group code; empty or absent is «any».
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<Sort>('name');
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);
  const { filters } = messages;

  const disciplineOptions = useMemo(() => {
    const options = optionsOf(
      items,
      (item) => item.discipline,
      (item) => item.disciplineName,
      locale
    );
    // A discipline the address asks for, with no products yet, stays in the list so the select
    // shows what is filtered (FC 052 T1.2).
    return isDiscipline(discipline) &&
      !options.some((option) => option.slug === discipline)
      ? [...options, { slug: discipline, name: disciplineNames[discipline] }]
      : options;
  }, [items, locale, discipline, disciplineNames]);
  /** The discipline asked for when the catalog holds no product of it (FC 052 T1.2). */
  const noneOf =
    isDiscipline(discipline) &&
    !items.some((item) => item.discipline === discipline)
      ? discipline
      : null;
  const propertyFilterList = useMemo(
    () => propertyFilters(items, locale),
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
            Object.entries(chosen).every(
              ([group, value]) =>
                value === '' ||
                item.properties.some(
                  (property) =>
                    property.groupCode === group && property.valueCode === value
                )
            ) &&
            (found === null || found.has(item.slug))
        )
        .sort(comparator(sort, locale)),
    [items, discipline, chosen, found, sort, locale]
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
      <fieldset className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        {propertyFilterList.map((filter) => (
          <Filter
            key={filter.code}
            label={filter.name}
            value={chosen[filter.code] ?? ''}
            onChange={(value) =>
              setChosen((current) => ({ ...current, [filter.code]: value }))
            }
            disabled={!isMounted}
          >
            <option value="">{filters.any}</option>
            {filter.values.map((value) => (
              <option key={value.code} value={value.code}>
                {value.name}
              </option>
            ))}
          </Filter>
        ))}
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
          <p>
            {noneOf
              ? fill(filters.emptyDiscipline, {
                  discipline: disciplineNames[noneOf],
                })
              : filters.empty}
          </p>
          <button
            type="button"
            onClick={() => {
              setDiscipline('');
              setChosen({});
              setQuery('');
            }}
            className="min-h-11 rounded-md border border-petroleo px-5 font-semibold"
          >
            {noneOf ? filters.seeAll : filters.reset}
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
