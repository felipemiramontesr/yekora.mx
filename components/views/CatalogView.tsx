import { Compass } from 'lucide-react';
import { getMessages, type Locale, type Messages } from '@/app/i18n';
import type { Product } from '@/lib/api/catalogClient';
import { priceNote, priceText } from '@/lib/catalog/format';
import type { CatalogSnapshot } from '@/lib/catalog/snapshot';
import { productPath, routeFor } from '@/lib/routes';
import { CatalogGrid, type GridItem } from '../catalog/CatalogGrid';

function gridItem(product: Product, locale: Locale): GridItem {
  return {
    slug: product.slug,
    href: productPath(product.slug, locale),
    name: product.name,
    discipline: product.discipline,
    disciplineName: product.disciplineName,
    level: product.level,
    levelName: product.levelName,
    priceMxnCents: product.priceMxnCents,
    price: priceText(product, locale),
    inStock: product.inStock,
    image: product.images[0] ?? null,
  };
}

// Empty catalog (production until the backoffice, K-07, loads products): a real state, never a
// broken page. It points to the disciplines so the visit still has somewhere to go.
function ComingSoon({
  locale,
  messages,
}: Readonly<{ locale: Locale; messages: Messages['catalog']['comingSoon'] }>) {
  return (
    <section
      data-coming-soon
      className="mt-10 rounded-xl bg-petroleo p-8 text-marfil md:p-12"
    >
      <p className="inline-block rounded-full border border-ocre px-3 py-1 text-sm">
        {messages.badge}
      </p>
      <h2 className="mt-6 text-2xl font-semibold md:text-3xl">
        {messages.title}
      </h2>
      <p className="mt-4 max-w-2xl leading-relaxed text-marfil/90">
        {messages.text}
      </p>
      <a
        href={`${routeFor('home', locale)}#disciplinas`}
        className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-md bg-marfil px-6 py-3 font-semibold text-petroleo"
      >
        <Compass aria-hidden="true" size={20} />
        {messages.cta}
      </a>
    </section>
  );
}

/**
 * Catalog page body, shared by `/catalogo/` and `/en/catalog/`: the products of the snapshot
 * with filters, or the «Próximamente» state while the catalog is empty.
 *
 * @param locale - Language of the page.
 * @param snapshot - Catalog the build was prepared with (lib/catalog/snapshot).
 */
export function CatalogView({
  locale,
  snapshot,
}: Readonly<{ locale: Locale; snapshot: CatalogSnapshot }>) {
  const { catalog } = getMessages(locale);
  const products = snapshot.products[locale];
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <h1 className="text-4xl font-semibold">{catalog.title}</h1>
      <p className="mt-4 max-w-3xl text-lg text-petroleo/80">{catalog.lede}</p>
      {products.length === 0 ? (
        <ComingSoon locale={locale} messages={catalog.comingSoon} />
      ) : (
        <>
          <p className="mt-4 text-sm text-petroleo/80">
            {priceNote(catalog.price, snapshot.exchangeRate, locale)}
          </p>
          <CatalogGrid
            locale={locale}
            items={products.map((product) => gridItem(product, locale))}
            messages={catalog}
          />
        </>
      )}
    </div>
  );
}
