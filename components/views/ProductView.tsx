import { ArrowLeft } from 'lucide-react';
import { getMessages, type Locale } from '@/app/i18n';
import type { ExchangeRate, Product } from '@/lib/api/catalogClient';
import { fill, priceNote, priceText } from '@/lib/catalog/format';
import { routeFor } from '@/lib/routes';
import { ProductVisual } from '../catalog/ProductVisual';

/** Props of {@link ProductView}. */
interface ProductViewProps {
  /** Language of the page. */
  locale: Locale;
  /** The product, in that language. */
  product: Product;
  /** FIX of the USD reference, or null. */
  exchangeRate: ExchangeRate | null;
}

/**
 * Product page body, shared by `/catalogo/<slug>/` and `/en/catalog/<slug>/`: gallery (or the
 * discipline pictogram), name, discipline and level, price in MXN (plus the USD reference in
 * English), availability and description.
 */
export function ProductView({
  locale,
  product,
  exchangeRate,
}: Readonly<ProductViewProps>) {
  const { catalog } = getMessages(locale);
  const price = priceText(product, locale);
  const gallery = product.images.length > 0 ? product.images : [null];
  return (
    <article className="mx-auto max-w-6xl px-4 py-12">
      <a
        href={routeFor('catalog', locale)}
        className="tap-target gap-2 text-sm underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" size={18} />
        {catalog.product.back}
      </a>
      <div className="mt-6 grid gap-10 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          {gallery.map((image, index) => (
            <ProductVisual
              key={image?.path ?? 'pictogram'}
              image={image}
              discipline={product.discipline}
              loading={index === 0 ? 'eager' : 'lazy'}
            />
          ))}
        </div>
        <div>
          <h1 className="text-3xl font-semibold md:text-4xl">{product.name}</h1>
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="font-semibold">{catalog.product.discipline}:</dt>
              <dd>{product.disciplineName}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-semibold">{catalog.product.level}:</dt>
              <dd>
                <span className="rounded-full border border-ocre px-2 py-0.5">
                  {product.levelName}
                </span>
              </dd>
            </div>
          </dl>
          <p className="mt-8 text-3xl font-semibold">{price.mxn}</p>
          {price.usd && (
            <p className="mt-1 text-petroleo/80">
              {fill(catalog.price.usdReference, { usd: price.usd })}
            </p>
          )}
          <p className="mt-2 text-sm text-petroleo/80">
            {priceNote(catalog.price, exchangeRate, locale)}
          </p>
          <p className="mt-6 font-semibold">
            {product.inStock
              ? catalog.product.inStock
              : catalog.product.outOfStock}
          </p>
          <p className="mt-6 whitespace-pre-line leading-relaxed">
            {product.description}
          </p>
          <p className="mt-8 text-xs text-petroleo/80">
            {catalog.product.sku}: {product.sku}
          </p>
        </div>
      </div>
    </article>
  );
}
