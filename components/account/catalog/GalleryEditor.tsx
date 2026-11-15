'use client';

import { useState } from 'react';
import {
  type AdminProduct,
  replaceGallery,
} from '@/lib/api/catalogAdminClient';
import { fill } from '@/lib/catalog/format';
import { type CatalogTexts, catalogFailureText } from './catalogTexts';
import { imagesOf, type Photo, PhotoList, photosInRange } from './PhotoList';

/**
 * The gallery of one product (FC 029 F3, T1.2): its photos in order, the first one primary, each
 * with its alt text in both languages; add a photo through the crop panel, move it, remove it,
 * and save. A photo uploaded but not saved is not in the gallery yet. Removing a photo retires it
 * (T2.3c): the image stays stored and can come back. From 1 to 5 photos (FC 049 T2.4): saving is
 * off outside that range.
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
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const result = await replaceGallery(product.id, {
      images: imagesOf(photos),
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
      <PhotoList texts={texts} photos={photos} onChange={setPhotos} />
      <button
        type="button"
        disabled={busy || !photosInRange(photos)}
        onClick={() => void save()}
        className="tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60"
      >
        {busy ? t.saving : t.save}
      </button>
    </section>
  );
}
