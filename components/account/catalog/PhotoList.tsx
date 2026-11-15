'use client';

import { useState } from 'react';
import { API_URL } from '@/lib/api/http';
import { MAX_GALLERY_PHOTOS } from '@/lib/catalog/adminTypes';
import { TextField } from '../../ui/TextField';
import type { CatalogTexts } from './catalogTexts';
import { PhotoCropper } from './PhotoCropper';

/** One photo of a gallery as the forms hold it: its digest and its alt texts as typed. */
export interface Photo {
  sha256: string;
  altEs: string;
  altEn: string;
}

/** Fewest photos a product holds (FC 049): it is never without one. */
const MIN_PHOTOS = 1;

/**
 * Whether a list of photos is one the API accepts: from one to {@link MAX_GALLERY_PHOTOS}. The
 * forms keep their save button off outside it.
 *
 * @param photos - The photos as arranged.
 * @returns True when the count is in range.
 */
export function photosInRange(photos: readonly Photo[]): boolean {
  return photos.length >= MIN_PHOTOS && photos.length <= MAX_GALLERY_PHOTOS;
}

/**
 * The photos of a product as the API takes them: alt texts trimmed, empty ones as null.
 *
 * @param photos - The photos as arranged.
 * @returns The gallery to send, in order.
 */
export function imagesOf(photos: readonly Photo[]) {
  return photos.map((photo) => ({
    sha256: photo.sha256,
    altEs: photo.altEs.trim() || null,
    altEn: photo.altEn.trim() || null,
  }));
}

/**
 * The photos of a product, shared by the creation form and the gallery editor (FC 049 T2.3,
 * T2.4): the list in order (the first one primary) with an alt text in both languages for each,
 * move up and down, remove, and add one through the crop panel. The list never goes below one
 * photo nor above five: the buttons that would leave the range are off.
 *
 * @param texts - `account.catalog` texts.
 * @param photos - The photos as arranged.
 * @param onChange - Called with the new arrangement.
 */
export function PhotoList({
  texts,
  photos,
  onChange,
}: Readonly<{
  texts: CatalogTexts;
  photos: readonly Photo[];
  onChange: (photos: Photo[]) => void;
}>) {
  const t = texts.media;
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const change = (index: number, patch: Partial<Photo>) =>
    onChange(
      photos.map((photo, at) => (at === index ? { ...photo, ...patch } : photo))
    );

  const move = (index: number, by: -1 | 1) => {
    const next = [...photos];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    onChange(next);
  };

  function added(sha256: string) {
    setAdding(false);
    if (photos.some((photo) => photo.sha256 === sha256)) {
      setNote(t.duplicate);
      return;
    }
    setNote(null);
    onChange([...photos, { sha256, altEs: '', altEn: '' }]);
  }

  const full = photos.length >= MAX_GALLERY_PHOTOS;
  return (
    <div className="flex flex-col gap-4">
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
              <TextField
                id={`photo-${photo.sha256}-alt-es`}
                label={t.altEs}
                {...t.fields.altEs}
                exampleLabel={texts.exampleLabel}
                input={{
                  value: photo.altEs,
                  maxLength: 255,
                  onChange: (event) =>
                    change(index, { altEs: event.target.value }),
                }}
              />
              <TextField
                id={`photo-${photo.sha256}-alt-en`}
                label={t.altEn}
                {...t.fields.altEn}
                exampleLabel={texts.exampleLabel}
                input={{
                  value: photo.altEn,
                  maxLength: 255,
                  onChange: (event) =>
                    change(index, { altEn: event.target.value }),
                }}
              />
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
                  disabled={photos.length <= MIN_PHOTOS}
                  onClick={() =>
                    onChange(photos.filter((_, at) => at !== index))
                  }
                  className="tap-target underline disabled:opacity-40"
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
          disabled={full}
          onClick={() => setAdding(true)}
          className="tap-target self-start underline disabled:opacity-40"
        >
          {full ? t.full : t.addPhoto}
        </button>
      )}
    </div>
  );
}
