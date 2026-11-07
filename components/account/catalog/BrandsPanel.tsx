'use client';

import { type SubmitEvent, useCallback, useEffect, useState } from 'react';
import {
  type Brand,
  createBrand,
  listBrands,
  updateBrand,
} from '@/lib/api/catalogAdminClient';
import { type CatalogTexts, catalogFailureText } from './catalogTexts';

/** What the panel says after an action: a confirmation or the refusal. */
type Note = { kind: 'ok' | 'error'; text: string } | null;

/** A text field, like the checkout's. */
const FIELD = 'min-h-11 rounded-md border border-petroleo/30 bg-white px-3';

/** A form field as trimmed text; a file or a missing field reads as empty. */
function textOf(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** An empty website field is "no website". */
const websiteOf = (data: FormData) => textOf(data, 'website') || null;

/**
 * Brands of the catalog (FC 029 F2b, F3): every brand, active or retired, a form to create one
 * and, per brand, editing its name and website and retiring or reactivating it. The slug is
 * fixed once created, because published pages may name it.
 *
 * @param texts - `account.catalog` texts.
 */
export function BrandsPanel({ texts }: Readonly<{ texts: CatalogTexts }>) {
  const t = texts.brands;
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await listBrands();
    if (result.ok) setBrands(result.data);
    else
      setNote({
        kind: 'error',
        text: catalogFailureText(texts, result.reason),
      });
  }, [texts]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one write, then reloads the list and says how it went. */
  async function run(
    write: () => ReturnType<typeof createBrand>,
    done: string
  ) {
    setBusy(true);
    const result = await write();
    setBusy(false);
    if (!result.ok) {
      setNote({
        kind: 'error',
        text: catalogFailureText(texts, result.reason),
      });
      return false;
    }
    setNote({ kind: 'ok', text: done });
    setEditing(null);
    await load();
    return true;
  }

  async function create(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const created = await run(
      () =>
        createBrand({
          slug: textOf(data, 'slug'),
          name: textOf(data, 'name'),
          website: websiteOf(data),
        }),
      t.created
    );
    if (created) form.reset();
  }

  async function save(event: SubmitEvent<HTMLFormElement>, id: number) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(
      () =>
        updateBrand(id, {
          name: textOf(data, 'name'),
          website: websiteOf(data),
        }),
      t.saved
    );
  }

  return (
    <section className="flex flex-col gap-6">
      {note && (
        <output
          className={`block ${note.kind === 'error' ? 'text-red-800' : ''}`}
        >
          {note.text}
        </output>
      )}
      {brands === null ? (
        <output className="block">{texts.loading}</output>
      ) : (
        <BrandTable
          texts={texts}
          brands={brands}
          editing={editing}
          busy={busy}
          onEdit={setEditing}
          onSave={save}
          onToggle={(brand) =>
            void run(
              () => updateBrand(brand.id, { isActive: !brand.isActive }),
              t.saved
            )
          }
        />
      )}
      <form
        onSubmit={(event) => void create(event)}
        className="flex max-w-xl flex-col gap-3"
      >
        <h2 className="text-lg font-semibold">{t.new}</h2>
        <label className="flex flex-col gap-1">
          {t.name}
          <input name="name" required maxLength={150} className={FIELD} />
        </label>
        <label className="flex flex-col gap-1">
          {t.slug}
          <input
            name="slug"
            required
            maxLength={100}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            aria-describedby="brand-slug-hint"
            className={FIELD}
          />
          <span id="brand-slug-hint" className="text-sm">
            {t.slugHint}
          </span>
        </label>
        <label className="flex flex-col gap-1">
          {t.website}
          <input
            name="website"
            type="url"
            maxLength={255}
            aria-describedby="brand-website-hint"
            className={FIELD}
          />
          <span id="brand-website-hint" className="text-sm">
            {t.websiteHint}
          </span>
        </label>
        <button
          type="submit"
          disabled={busy}
          className="tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60"
        >
          {busy ? t.creating : t.create}
        </button>
      </form>
    </section>
  );
}

/** The table of brands, with one row in edit mode at most. */
function BrandTable({
  texts,
  brands,
  editing,
  busy,
  onEdit,
  onSave,
  onToggle,
}: Readonly<{
  texts: CatalogTexts;
  brands: Brand[];
  editing: number | null;
  busy: boolean;
  onEdit: (id: number | null) => void;
  onSave: (event: SubmitEvent<HTMLFormElement>, id: number) => Promise<void>;
  onToggle: (brand: Brand) => void;
}>) {
  const t = texts.brands;
  if (brands.length === 0) return <p>{t.empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{t.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t.name}</th>
            <th scope="col">{t.slug}</th>
            <th scope="col">{t.website}</th>
            <th scope="col">{t.status}</th>
            <th scope="col">{t.actions}</th>
          </tr>
        </thead>
        <tbody>
          {brands.map((brand) =>
            editing === brand.id ? (
              <tr key={brand.id}>
                <td colSpan={5}>
                  <form
                    onSubmit={(event) => void onSave(event, brand.id)}
                    className="flex flex-wrap items-end gap-3 py-2"
                  >
                    <label className="flex flex-col gap-1">
                      {t.name}
                      <input
                        name="name"
                        required
                        maxLength={150}
                        defaultValue={brand.name}
                        className={FIELD}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      {t.website}
                      <input
                        name="website"
                        type="url"
                        maxLength={255}
                        defaultValue={brand.website ?? ''}
                        className={FIELD}
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={busy}
                      className="tap-target underline"
                    >
                      {busy ? t.saving : t.save}
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit(null)}
                      className="tap-target underline"
                    >
                      {t.cancel}
                    </button>
                  </form>
                </td>
              </tr>
            ) : (
              <tr key={brand.id}>
                <td>{brand.name}</td>
                <td>{brand.slug}</td>
                <td>{brand.website ?? '—'}</td>
                <td>{brand.isActive ? t.active : t.retired}</td>
                <td className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => onEdit(brand.id)}
                    className="tap-target underline"
                  >
                    {t.edit}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onToggle(brand)}
                    className="tap-target underline"
                  >
                    {brand.isActive ? t.retire : t.reactivate}
                  </button>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
