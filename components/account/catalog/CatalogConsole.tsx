'use client';

import { FolderTree, Package, SlidersHorizontal, Upload } from 'lucide-react';
import type { MouseEvent } from 'react';
import { BrandsPanel } from './BrandsPanel';
import type { Locale } from '@/app/i18n';
import type { CatalogSection } from '@/lib/account/accountPaths';
import { FacetsPanel } from './FacetsPanel';
import type { CatalogTexts } from './catalogTexts';
import { ProductsPanel } from './ProductsPanel';
import { PublishPanel } from './PublishPanel';

/** Sections of the console, in order, with the address each one has (FC 052). */
const SECTIONS = [
  ['brands', 'marcas', FolderTree],
  ['facets', 'propiedades', SlidersHorizontal],
  ['products', 'productos', Package],
  ['publish', 'publicar', Upload],
] as const;

/** The centre of the catalog (FC 078 T2.4): one card for each of its four sections. */
function CatalogCentre({
  texts,
  hrefOf,
  onOpen,
}: Readonly<{
  texts: CatalogTexts;
  hrefOf: (section: CatalogSection) => string;
  onOpen: (section: CatalogSection) => void;
}>) {
  return (
    <section aria-label={texts.sectionsLabel}>
      <ul className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map(([name, address, Icon]) => (
          <li key={name}>
            <a
              href={hrefOf(address)}
              onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                event.preventDefault();
                onOpen(address);
              }}
              className="flex h-full flex-col gap-3 rounded-xl border border-petroleo/20 bg-white/60 p-5 hover:border-petroleo focus-visible:border-petroleo"
            >
              <span className="flex items-center gap-3 text-lg font-semibold">
                <Icon aria-hidden="true" size={28} />
                {texts.center[name].name}
              </span>
              <span className="text-petroleo/80">
                {texts.center[name].description}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The catalog console of `/cuenta/catalogo` (FC 029 F3, ADR 0011): shown only to an account
 * with `catalog:write`, and only as a convenience, since the API refuses every write without it.
 * Changes are saved at once; «Publicar cambios» rebuilds the store with them.
 *
 * Its own address shows the centre, four cards (FC 078 T2.4). Each section has an address of its
 * own (`/cuenta/catalogo/productos/`, …) and carries the tabs to move between them; the way back to
 * the centre is the breadcrumb of the area.
 *
 * @param texts - `account.catalog` texts.
 * @param locale - Language of the page, for the prices.
 * @param open - The section the address asks for, or none (the centre).
 * @param hrefOf - Address of a section, for the cards of the centre.
 * @param onOpen - Called with the section the person chooses, to put it in the address.
 */
export function CatalogConsole({
  texts,
  locale,
  open,
  hrefOf,
  onOpen,
}: Readonly<{
  texts: CatalogTexts;
  locale: Locale;
  open: CatalogSection | null;
  hrefOf: (section: CatalogSection) => string;
  onOpen: (section: CatalogSection) => void;
}>) {
  const section = SECTIONS.find(([, address]) => address === open)?.[0];
  if (section === undefined) {
    return <CatalogCentre texts={texts} hrefOf={hrefOf} onOpen={onOpen} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        aria-label={texts.sectionsLabel}
        className="flex gap-4"
      >
        {SECTIONS.map(([name, address]) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={section === name}
            onClick={() => onOpen(address)}
            className="tap-target rounded-full border border-petroleo/30 px-4 aria-selected:bg-petroleo aria-selected:text-marfil"
          >
            {texts.sections[name]}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {section === 'brands' && <BrandsPanel texts={texts} />}
        {section === 'facets' && <FacetsPanel texts={texts} />}
        {section === 'products' && (
          <ProductsPanel texts={texts} locale={locale} />
        )}
        {section === 'publish' && <PublishPanel texts={texts} />}
      </div>
    </div>
  );
}
