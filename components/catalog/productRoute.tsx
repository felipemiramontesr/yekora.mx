import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { Locale } from '@/app/i18n';
import {
  findProduct,
  loadSnapshot,
  productParams,
} from '@/lib/catalog/snapshot';
import { productMetadata } from '@/lib/routes';
import { ProductView } from '../views/ProductView';

/** Route params of a product page. */
interface ProductPageProps {
  /** `{ slug }`, a Promise in Next 15. */
  params: Promise<{ slug: string }>;
}

/**
 * The `[slug]` route of one language: one prerendered page per product of the snapshot.
 * Both languages share it, so the two page files only bind a locale.
 *
 * An empty catalog prerenders the placeholder slug only (Next's export needs at least one
 * param); that page is a 404 marked noindex, and the build deletes it from out/
 * (scripts/pruneCatalogPlaceholder.ts), so no URL of it is ever published.
 *
 * @param locale - Language of the route.
 * @returns `generateStaticParams`, `generateMetadata` and the page component.
 */
export function productRoute(locale: Locale) {
  return {
    generateStaticParams: () => productParams(loadSnapshot(), locale),
    generateMetadata: async ({
      params,
    }: ProductPageProps): Promise<Metadata> => {
      const product = findProduct(loadSnapshot(), locale, (await params).slug);
      return product
        ? productMetadata(product, locale)
        : { robots: { index: false, follow: false } };
    },
    Page: async function ProductPage({ params }: ProductPageProps) {
      const snapshot = loadSnapshot();
      const product = findProduct(snapshot, locale, (await params).slug);
      if (!product) notFound();
      return (
        <ProductView
          locale={locale}
          product={product}
          exchangeRate={snapshot.exchangeRate}
        />
      );
    },
  };
}
