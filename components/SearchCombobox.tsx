'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { z } from 'zod';
import type { Locale, Messages } from '@/app/i18n';
import { fill } from '@/lib/catalog/format';
import { matchEntries, type SearchEntry } from '@/lib/catalog/search';
import { productPath } from '@/lib/routes';

/** The most suggestions listed under the box. */
const MAX_SUGGESTIONS = 8;

/** What the search index file holds (lib/catalog/search). */
const indexSchema = z.array(
  z.object({
    slug: z.string(),
    name: z.string(),
    discipline: z.string(),
    disciplineName: z.string(),
  })
);

/**
 * The product search of the header (FC 047 T1.2, T2.2): a WAI-ARIA combobox with a listbox of
 * suggestions, over an index of the catalog that is fetched the first time the box takes the
 * focus, never before, so the pages carry none of it. The arrows move through the suggestions,
 * Enter opens the product that is highlighted, Escape closes the list, and a polite status says
 * how many there are. Anything else sent with Enter, or with the button, is the same form
 * submitted to the catalog page (`?q=`), so the search also works without JavaScript and when the
 * index cannot be loaded.
 *
 * @param locale - Language of the page: the product pages it opens.
 * @param action - The catalog page of that language, where a full search goes.
 * @param indexUrl - Where the index of that language is served from.
 * @param messages - `header.search` texts.
 */
export function SearchCombobox({
  locale,
  action,
  indexUrl,
  messages,
}: Readonly<{
  locale: Locale;
  action: string;
  indexUrl: string;
  messages: Messages['header']['search'];
}>) {
  const id = useId();
  const listId = `${id}-list`;
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const asked = useRef(false);
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<SearchEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const matches = useMemo(
    () => (entries ? matchEntries(entries, query, MAX_SUGGESTIONS) : []),
    [entries, query]
  );
  const typed = query.trim() !== '';
  const listed = open && typed && matches.length > 0;
  const empty = open && typed && entries !== null && matches.length === 0;

  // The box is uncontrolled: whatever was typed before React took over the page is kept, never
  // reset to empty at hydration, and is read here.
  // Effects run after the commit, so the ref already holds the element.
  useEffect(() => setQuery((field.current as HTMLInputElement).value), []);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  /** Fetches the index once, on the first focus. */
  function load() {
    if (asked.current) return;
    asked.current = true;
    fetch(indexUrl)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then((data: unknown) => setEntries(indexSchema.parse(data)))
      .catch(() => setFailed(true));
  }

  function go(entry: SearchEntry) {
    setOpen(false);
    router.push(productPath(entry.slug, locale));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (matches.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) =>
        current === -1 && step === -1
          ? matches.length - 1
          : (current + step + matches.length) % matches.length
      );
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    } else if (event.key === 'Enter' && listed && active >= 0) {
      event.preventDefault();
      go(matches[active]);
    }
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }

  let status = '';
  if (failed) status = messages.loadFailed;
  else if (listed) status = fill(messages.count, { count: matches.length });
  else if (empty) status = fill(messages.none, { query: query.trim() });

  return (
    <div ref={container} onBlur={onBlur} className="relative w-full">
      <form
        role="search"
        action={action}
        method="get"
        className="flex w-full overflow-hidden rounded-md"
      >
        <input
          ref={field}
          name="q"
          type="text"
          role="combobox"
          aria-label={messages.label}
          aria-autocomplete="list"
          aria-expanded={listed}
          aria-controls={listId}
          aria-activedescendant={
            listed && active >= 0 ? `${id}-${active}` : undefined
          }
          autoComplete="off"
          enterKeyHint="search"
          placeholder={messages.placeholder}
          onFocus={() => {
            load();
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="h-11 min-w-0 flex-1 bg-marfil px-4 text-petroleo placeholder:text-petroleo/60"
        />
        <button
          type="submit"
          aria-label={messages.submit}
          className="flex h-11 w-12 shrink-0 items-center justify-center bg-ocre text-petroleo hover:brightness-110"
        >
          <Search aria-hidden="true" size={22} />
        </button>
      </form>
      <p role="status" className="sr-only">
        {status}
      </p>
      {listed && (
        <ul
          id={listId}
          role="listbox"
          aria-label={messages.suggestions}
          className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-md bg-marfil text-petroleo shadow-lg"
        >
          {matches.map((entry, index) => (
            <li
              key={entry.slug}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => go(entry)}
              className={`flex cursor-pointer flex-col px-4 py-2 ${
                index === active ? 'bg-petroleo/10' : 'hover:bg-petroleo/5'
              }`}
            >
              <span className="font-semibold">{entry.name}</span>
              <span className="text-xs text-petroleo/80">
                {entry.disciplineName}
              </span>
            </li>
          ))}
        </ul>
      )}
      {empty && (
        <p className="absolute inset-x-0 top-full z-50 mt-1 rounded-md bg-marfil p-4 text-sm text-petroleo shadow-lg">
          {fill(messages.none, { query: query.trim() })}
        </p>
      )}
    </div>
  );
}
