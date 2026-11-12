'use client';

import { type ReactNode, type SubmitEvent, useEffect, useState } from 'react';
import {
  type AdminProduct,
  type Brand,
  createProduct,
  type FacetGroup,
  listBrands,
  listFacets,
  updateProduct,
} from '@/lib/api/catalogAdminClient';
import { fill } from '@/lib/catalog/format';
import { type CatalogTexts, catalogFailureText } from './catalogTexts';
import { FIELD, textOf } from './formHelpers';

/** Disciplines and shipping classes seeded by migrations 001 and 002: suggestions, not a limit. */
const DISCIPLINES = [
  'senderismo',
  'montana',
  'escalada',
  'canonismo',
  'trail-running',
];
const SHIPPING_CLASSES = ['estandar', 'voluminoso'];

/** The brands and facet groups a product form offers. */
interface Options {
  brands: Brand[];
  groups: FacetGroup[];
}

/** What a product form carries besides SKU and slug, read from its fields. */
function fieldsOf(data: FormData) {
  const brand = textOf(data, 'brandId');
  return {
    nameEs: textOf(data, 'nameEs'),
    nameEn: textOf(data, 'nameEn'),
    descriptionEs: textOf(data, 'descriptionEs'),
    descriptionEn: textOf(data, 'descriptionEn'),
    // Pesos with cents as typed (4850.10), kept in whole cents like the API.
    priceMxnCents: Math.round(Number(textOf(data, 'price')) * 100),
    stock: Number(textOf(data, 'stock')),
    discipline: textOf(data, 'discipline'),
    level: textOf(data, 'level'),
    brandId: brand === '' ? null : Number(brand),
    shippingClass: textOf(data, 'shippingClass'),
    weightGrams: Number(textOf(data, 'weightGrams')),
    lengthMm: Number(textOf(data, 'lengthMm')),
    widthMm: Number(textOf(data, 'widthMm')),
    heightMm: Number(textOf(data, 'heightMm')),
    facetValueIds: data.getAll('facetValueIds').map(Number),
  };
}

/** One text or number field of the form, with its optional hint. */
function Field({
  label,
  hint,
  children,
}: Readonly<{ label: string; hint?: string; children: ReactNode }>) {
  return (
    <label className="flex flex-col gap-1">
      {label}
      {children}
      {hint && <span className="text-sm">{hint}</span>}
    </label>
  );
}

/**
 * The form of one product, to create it or to edit it (FC 029 F3, T1.1). SKU and slug are typed
 * once: orders and published addresses name them, so an existing product shows them read-only.
 * The price is typed in pesos and sent in cents; the level is one of the system group Nivel; the
 * facets are the values of the ordinary groups. The gallery is arranged in the media section.
 *
 * @param texts - `account.catalog` texts.
 * @param product - The product to edit, or null for a new one.
 * @param onSaved - Called with the confirmation once the API accepted the write.
 * @param onCancel - Called to go back to the list.
 */
export function ProductForm({
  texts,
  product,
  onSaved,
  onCancel,
}: Readonly<{
  texts: CatalogTexts;
  product: AdminProduct | null;
  onSaved: (message: string) => void;
  onCancel: () => void;
}>) {
  const t = texts.products;
  const submitText =
    product === null
      ? { idle: t.create, busy: t.creating }
      : { idle: t.save, busy: t.saving };
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([listBrands(), listFacets()]).then(([brands, facets]) => {
      if (!brands.ok) setError(catalogFailureText(texts, brands.reason));
      else if (!facets.ok) setError(catalogFailureText(texts, facets.reason));
      else setOptions({ brands: brands.data, groups: facets.data });
    });
  }, [texts]);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const fields = fieldsOf(data);
    setBusy(true);
    const result =
      product === null
        ? await createProduct({
            sku: textOf(data, 'sku'),
            slug: textOf(data, 'slug'),
            ...fields,
          })
        : await updateProduct(product.id, fields);
    setBusy(false);
    if (result.ok) onSaved(product === null ? t.created : t.saved);
    else setError(catalogFailureText(texts, result.reason));
  }

  return (
    <section className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onCancel}
        className="tap-target self-start underline"
      >
        {t.back}
      </button>
      <h2 className="text-lg font-semibold">
        {product === null ? t.titleNew : t.titleEdit}
      </h2>
      {error && <output className="block text-red-800">{error}</output>}
      {options === null ? (
        <output className="block">{texts.loading}</output>
      ) : (
        <form
          onSubmit={(event) => void submit(event)}
          aria-label={product === null ? t.titleNew : t.titleEdit}
          className="flex max-w-xl flex-col gap-3"
        >
          {product === null ? (
            <>
              <Field label={t.sku} hint={t.skuHint}>
                <input
                  name="sku"
                  required
                  maxLength={64}
                  pattern="[A-Z0-9][A-Z0-9\-]*"
                  className={FIELD}
                />
              </Field>
              <Field label={t.slug} hint={t.slugHint}>
                <input
                  name="slug"
                  required
                  maxLength={160}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  className={FIELD}
                />
              </Field>
            </>
          ) : (
            <p className="text-sm">
              {t.sku}: {product.sku} · {t.slug}: {product.slug}
            </p>
          )}
          <Field label={t.nameEs}>
            <input
              name="nameEs"
              required
              maxLength={200}
              defaultValue={product?.nameEs}
              className={FIELD}
            />
          </Field>
          <Field label={t.nameEn}>
            <input
              name="nameEn"
              required
              maxLength={200}
              defaultValue={product?.nameEn}
              className={FIELD}
            />
          </Field>
          <Field label={t.descriptionEs}>
            <textarea
              name="descriptionEs"
              rows={4}
              maxLength={10000}
              defaultValue={product?.descriptionEs}
              className={FIELD}
            />
          </Field>
          <Field label={t.descriptionEn}>
            <textarea
              name="descriptionEn"
              rows={4}
              maxLength={10000}
              defaultValue={product?.descriptionEn}
              className={FIELD}
            />
          </Field>
          <Field label={t.priceMxn}>
            <input
              name="price"
              type="number"
              required
              min={0.01}
              step={0.01}
              defaultValue={product ? product.priceMxnCents / 100 : undefined}
              className={FIELD}
            />
          </Field>
          <Field label={t.stockField}>
            <input
              name="stock"
              type="number"
              required
              min={0}
              step={1}
              defaultValue={product?.stock ?? 0}
              className={FIELD}
            />
          </Field>
          {product && (
            <p className="text-sm">
              {fill(t.reservedNote, { n: String(product.reservedStock) })}
            </p>
          )}
          <Field label={t.discipline} hint={t.disciplineHint}>
            <input
              name="discipline"
              required
              maxLength={40}
              list="product-disciplines"
              defaultValue={product?.discipline}
              className={FIELD}
            />
          </Field>
          <datalist id="product-disciplines">
            {DISCIPLINES.map((slug) => (
              <option key={slug} value={slug} />
            ))}
          </datalist>
          <Field label={t.level}>
            <select
              name="level"
              required
              defaultValue={product?.level ?? ''}
              className={FIELD}
            >
              <option value="">{t.levelChoose}</option>
              {options.groups
                .filter((group) => group.isSystem)
                .flatMap((group) => group.values)
                .map((value) => (
                  <option key={value.id} value={value.code}>
                    {value.valueEs}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={t.brand}>
            <select
              name="brandId"
              defaultValue={product?.brandId ?? ''}
              className={FIELD}
            >
              <option value="">{t.noBrand}</option>
              {options.brands
                .filter(
                  (brand) => brand.isActive || brand.id === product?.brandId
                )
                .map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={t.shippingClass} hint={t.shippingHint}>
            <input
              name="shippingClass"
              required
              maxLength={40}
              list="product-shipping-classes"
              defaultValue={product?.shippingClass}
              className={FIELD}
            />
          </Field>
          <datalist id="product-shipping-classes">
            {SHIPPING_CLASSES.map((slug) => (
              <option key={slug} value={slug} />
            ))}
          </datalist>
          {(
            [
              ['weightGrams', t.weight],
              ['lengthMm', t.length],
              ['widthMm', t.width],
              ['heightMm', t.height],
            ] as const
          ).map(([name, label]) => (
            <Field key={name} label={label}>
              <input
                name={name}
                type="number"
                required
                min={1}
                step={1}
                defaultValue={product?.[name]}
                className={FIELD}
              />
            </Field>
          ))}
          {options.groups
            .filter((group) => !group.isSystem && group.isActive)
            .map((group) => (
              <fieldset key={group.id} className="flex flex-col gap-2">
                <legend>{`${t.facets}: ${group.nameEs}`}</legend>
                {group.values.map((value) => (
                  <label key={value.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="facetValueIds"
                      value={value.id}
                      defaultChecked={product?.facetValueIds.includes(value.id)}
                    />
                    {value.valueEs}
                  </label>
                ))}
              </fieldset>
            ))}
          <button
            type="submit"
            disabled={busy}
            className="tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60"
          >
            {busy ? submitText.busy : submitText.idle}
          </button>
        </form>
      )}
    </section>
  );
}
