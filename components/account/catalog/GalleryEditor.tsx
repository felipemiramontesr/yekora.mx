'use client';

import { useState } from 'react';
import {
  type AdminProduct,
  replaceGallery,
} from '@/lib/api/catalogAdminClient';
import { API_URL } from '@/lib/api/http';
import { fill } from '@/lib/catalog/format';
import { type CatalogTexts, catalogFailureText } from './catalogTexts';
import { FIELD } from './formHelpers';
import { PhotoCropper } from './PhotoCropper';

/** The most photos a gallery holds (the API's own limit). */
const MAX_PHOTOS = 12;

/** One photo of the gallery as the editor holds it: its digest and its alt texts as typed. */
interface Photo {
  sha256: string;
  altEs: string;
  altEn: string;
}

/**
 * The gallery of one product (FC 029 F3, T1.2): its photos in order, the first one primary, each
 * with its alt text in both languages; add a photo through the crop panel, move it, remove it,
 * and save. A photo uploaded but not saved is not in the gallery yet. Removing a photo retires it
 * (T2.3c): the image stays stored and can come back.
 *
 * @param texts - `account.catalog` texts.
 * @param product - The product whose gallery is edited.
 * @param onSaved - Called with the confirmation once the API accepted the gallery.
 * @param onCancel - Called to go back to the list.
 */
export function GalleryEditor({
  texts,
  product,
  onSaved,
  onCancel,
}: Readonly<{
  texts: CatalogTexts;
  product: AdminProduct;
  onSaved: (message: string) => void;
  onCancel: () => void;
}>) {
  const t = texts.media;
  const [photos, setPhotos] = useState<Photo[]>(() =>
    product.gallery.map((image) => ({
      sha256: image.sha256,
      altEs: image.altEs ?? '',
      altEn: image.altEn ?? '',
    }))
  );
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = (index: number, patch: Partial<Photo>) =>
    setPhotos(
      photos.map((photo, at) => (at === index ? { ...photo, ...patch } : photo))
    );

  const move = (index: number, by: -1 | 1) => {
    const next = [...photos];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    setPhotos(next);
  };

  function added(sha256: string) {
    setAdding(false);
    if (photos.some((photo) => photo.sha256 === sha256)) {
      setNote(t.duplicate);
      return;
    }
    setNote(null);
    setPhotos([...photos, { sha256, altEs: '', altEn: '' }]);
  }

  async function save() {
    setBusy(true);
    const result = await replaceGallery(product.id, {
      images: photos.map((photo) => ({
        sha256: photo.sha256,
        altEs: photo.altEs.trim() || null,
        altEn: photo.altEn.trim() || null,
      })),
    });
    setBusy(false);
    if (result.ok) onSaved(t.saved);
    else setNote(catalogFailureText(texts, result.reason));
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
        {fill(t.title, { name: product.nameEs })}
      </h2>
      {note && <output className="block text-red-800">{note}</output>}
      {photos.length === 0 && <p>{t.empty}</p>}
      <ol className="flex flex-col gap-4">
        {photos.map((photo, index) => (
          <li
            key={photo.sha256}
            className="flex flex-wrap items-start gap-4 rounded-lg border border-petroleo/20 p-3"
          >
            <img
              src={`${API_URL}/v1/media/${photo.sha256}`}
              alt={photo.altEs}
              width={120}
              height={120}
              className="size-30 rounded-md object-cover"
            />
            <div className="flex flex-col gap-2">
              {index === 0 && <strong>{t.primary}</strong>}
              <label className="flex flex-col gap-1">
                {t.altEs}
                <input
                  value={photo.altEs}
                  maxLength={255}
                  onChange={(event) =>
                    change(index, { altEs: event.target.value })
                  }
                  className={FIELD}
                />
              </label>
              <label className="flex flex-col gap-1">
                {t.altEn}
                <input
                  value={photo.altEn}
                  maxLength={255}
                  onChange={(event) =>
                    change(index, { altEn: event.target.value })
                  }
                  className={FIELD}
                />
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="tap-target underline disabled:opacity-40"
                >
                  {t.moveUp}
                </button>
                <button
                  type="button"
                  disabled={index === photos.length - 1}
                  onClick={() => move(index, 1)}
                  className="tap-target underline disabled:opacity-40"
                >
                  {t.moveDown}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setPhotos(photos.filter((_, at) => at !== index))
                  }
                  className="tap-target underline"
                >
                  {t.remove}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {adding ? (
        <PhotoCropper
          texts={texts}
          onUploaded={added}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          disabled={photos.length >= MAX_PHOTOS}
          onClick={() => setAdding(true)}
          className="tap-target self-start underline disabled:opacity-40"
        >
          {photos.length >= MAX_PHOTOS ? t.full : t.addPhoto}
        </button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => void save()}
        className="tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60"
      >
        {busy ? t.saving : t.save}
      </button>
    </section>
  );
}
