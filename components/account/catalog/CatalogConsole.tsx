'use client';

import { BrandsPanel } from './BrandsPanel';
import type { Locale } from '@/app/i18n';
import type { CatalogSection } from '@/lib/account/accountPaths';
import { FacetsPanel } from './FacetsPanel';
import type { CatalogTexts } from './catalogTexts';
import { ProductsPanel } from './ProductsPanel';
import { PublishPanel } from './PublishPanel';

/** Sections of the console, in the order of its tabs, with the address each one has (FC 052). */
const SECTIONS = [
  ['brands', 'marcas'],
  ['facets', 'propiedades'],
  ['products', 'productos'],
  ['publish', 'publicar'],
] as const;

/**
 * The catalog console of `/cuenta/catalogo` (FC 029 F3, ADR 0011): shown only to an account
 * with `catalog:write`, and only as a convenience, since the API refuses every write without it.
 * Changes are saved at once; «Publicar cambios» rebuilds the store with them.
 *
 * Each tab has an address of its own (`/cuenta/catalogo/productos/`, …) so a card of the
 * administration hub can open it and the back button returns to the one before.
 *
 * @param texts - `account.catalog` texts.
 * @param locale - Language of the page, for the prices.
 * @param open - The tab asked for by the address, or none (the first one).
 * @param onOpen - Called with the tab the person chooses, to put it in the address.
 */
export function CatalogConsole({
  texts,
  locale,
  open,
  onOpen,
}: Readonly<{
  texts: CatalogTexts;
  locale: Locale;
  open: CatalogSection | null;
  onOpen: (section: CatalogSection) => void;
}>) {
  const section =
    SECTIONS.find(([, address]) => address === open)?.[0] ?? 'brands';
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
