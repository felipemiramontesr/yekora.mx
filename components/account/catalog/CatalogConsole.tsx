'use client';

import { useState } from 'react';
import { BrandsPanel } from './BrandsPanel';
import { FacetsPanel } from './FacetsPanel';
import type { CatalogTexts } from './catalogTexts';
import { PublishPanel } from './PublishPanel';

/** Sections of the console, in the order of its tabs. */
const SECTIONS = ['brands', 'facets', 'publish'] as const;

/**
 * The catalog console of `/cuenta/catalogo` (FC 029 F3, ADR 0011): shown only to an account
 * with `catalog:write`, and only as a convenience, since the API refuses every write without it.
 * Changes are saved at once; «Publicar cambios» rebuilds the store with them.
 *
 * @param texts - `account.catalog` texts.
 */
export function CatalogConsole({ texts }: Readonly<{ texts: CatalogTexts }>) {
  const [section, setSection] = useState<(typeof SECTIONS)[number]>('brands');
  return (
    <div className="flex flex-col gap-6">
      <div
        role="tablist"
        aria-label={texts.sectionsLabel}
        className="flex gap-4"
      >
        {SECTIONS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={section === name}
            onClick={() => setSection(name)}
            className="tap-target rounded-full border border-petroleo/30 px-4 aria-selected:bg-petroleo aria-selected:text-marfil"
          >
            {texts.sections[name]}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {section === 'brands' && <BrandsPanel texts={texts} />}
        {section === 'facets' && <FacetsPanel texts={texts} />}
        {section === 'publish' && <PublishPanel texts={texts} />}
      </div>
    </div>
  );
}
