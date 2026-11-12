'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Locale } from '@/app/i18n';
import {
  type AdminProduct,
  listProducts,
  type ProductPage,
  updateProduct,
} from '@/lib/api/catalogAdminClient';
import { fill, formatMoney } from '@/lib/catalog/format';
import { type CatalogTexts, catalogFailureText } from './catalogTexts';
import type { Note } from './formHelpers';
import { ProductForm } from './ProductForm';

/**
 * Products of the catalog (FC 029 F2b2, F3): every product, active or retired, page by page; a
 * form to create one; per product, editing it and retiring or reactivating it. Nothing is
 * deleted: retiring is `isActive: false` (T2.3c). The gallery is arranged in the media section.
 *
 * @param texts - `account.catalog` texts.
 * @param locale - Language of the page, for the prices.
 */
export function ProductsPanel({
  texts,
  locale,
}: Readonly<{ texts: CatalogTexts; locale: Locale }>) {
  const t = texts.products;
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ProductPage | null>(null);
  const [form, setForm] = useState<{ product: AdminProduct | null } | null>(
    null
  );
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await listProducts(page);
    if (result.ok) setData(result.data);
    else
      setNote({
        kind: 'error',
        text: catalogFailureText(texts, result.reason),
      });
  }, [page, texts]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(product: AdminProduct) {
    setBusy(true);
    const result = await updateProduct(product.id, {
      isActive: !product.isActive,
    });
    setBusy(false);
    if (!result.ok) {
      setNote({
        kind: 'error',
        text: catalogFailureText(texts, result.reason),
      });
      return;
    }
    setNote({ kind: 'ok', text: t.saved });
    await load();
  }

  if (form) {
    return (
      <ProductForm
        texts={texts}
        product={form.product}
        onCancel={() => setForm(null)}
        onSaved={(message) => {
          setForm(null);
          setNote({ kind: 'ok', text: message });
          void load();
        }}
      />
    );
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <section className="flex flex-col gap-6">
      {note && (
        <output
          className={`block ${note.kind === 'error' ? 'text-red-800' : ''}`}
        >
          {note.text}
        </output>
      )}
      <button
        type="button"
        onClick={() => setForm({ product: null })}
        className="tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil"
      >
        {t.new}
      </button>
      {data === null && <output className="block">{texts.loading}</output>}
      {data?.items.length === 0 && <p>{t.empty}</p>}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t.caption}</caption>
            <thead>
              <tr>
                <th scope="col">{t.sku}</th>
                <th scope="col">{t.name}</th>
                <th scope="col">{t.price}</th>
                <th scope="col">{t.stock}</th>
                <th scope="col">{t.status}</th>
                <th scope="col">{t.actions}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((product) => (
                <tr key={product.id}>
                  <td>{product.sku}</td>
                  <td>{product.nameEs}</td>
                  <td>{formatMoney(product.priceMxnCents, 'MXN', locale)}</td>
                  <td>
                    {product.stock}
                    {product.reservedStock > 0 &&
                      ` · ${fill(t.reserved, { n: String(product.reservedStock) })}`}
                  </td>
                  <td>
                    {product.isActive ? t.active : t.retired}
                    {product.isTest && ` · ${t.test}`}
                  </td>
                  <td className="flex gap-3">
                    <button
                      type="button"
                      aria-label={`${t.edit}: ${product.nameEs}`}
                      onClick={() => setForm({ product })}
                      className="tap-target underline"
                    >
                      {t.edit}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`${product.isActive ? t.retire : t.reactivate}: ${product.nameEs}`}
                      onClick={() => void toggle(product)}
                      className="tap-target underline"
                    >
                      {product.isActive ? t.retire : t.reactivate}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <nav className="flex items-center gap-4">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="tap-target underline disabled:opacity-40"
          >
            {t.previous}
          </button>
          <span>
            {fill(t.pageOf, { page: String(page), pages: String(pages) })}
          </span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
            className="tap-target underline disabled:opacity-40"
          >
            {t.next}
          </button>
        </nav>
      )}
    </section>
  );
}
