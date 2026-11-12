'use client';

import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { uploadMedia } from '@/lib/api/catalogAdminClient';
import {
  canvasBlob,
  type Crop,
  drawSquare,
  openImage,
  OUTPUT_WIDTHS,
} from '@/lib/catalog/imageCrop';
import { type CatalogTexts, catalogFailureText } from './catalogTexts';

/** Side of the live preview, in pixels. */
const PREVIEW_SIDE = 240;

/** The whole photo, centred, with no zoom. */
const WHOLE: Crop = { zoom: 1, x: 0.5, y: 0.5 };

/**
 * The panel that crops and uploads one photo (FC 029 F3, T1.2 D): the administrator chooses a
 * file, picks a square with a zoom and a position, sees it in a preview, picks one of the three
 * widths and uploads it. The Canvas does the resize in the browser; the API checks the type, the
 * size and the width again. Sliders and a select, not dragging, so the keyboard reaches
 * everything.
 *
 * @param texts - `account.catalog` texts.
 * @param onUploaded - Called with the digest the API stored the photo under.
 * @param onCancel - Called to close the panel without a photo.
 */
export function PhotoCropper({
  texts,
  onUploaded,
  onCancel,
}: Readonly<{
  texts: CatalogTexts;
  onUploaded: (sha256: string) => void;
  onCancel: () => void;
}>) {
  const t = texts.media;
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [crop, setCrop] = useState<Crop>(WHOLE);
  const [width, setWidth] = useState<(typeof OUTPUT_WIDTHS)[number]>(1200);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (image && preview.current)
      drawSquare(preview.current, image, crop, PREVIEW_SIDE);
  }, [image, crop]);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const opened = await openImage(file);
    setError(opened ? null : t.invalid);
    setCrop(WHOLE);
    setImage(opened);
  }

  async function upload(photo: ImageBitmap) {
    setBusy(true);
    setError(null);
    const canvas = document.createElement('canvas');
    const drawn = drawSquare(canvas, photo, crop, width);
    const blob = drawn ? await canvasBlob(canvas) : null;
    const result = blob ? await uploadMedia(blob) : null;
    setBusy(false);
    if (result?.ok) onUploaded(result.data.sha256);
    else
      setError(result ? catalogFailureText(texts, result.reason) : t.prepare);
  }

  /** One slider of the crop. */
  const slider = (
    label: string,
    field: keyof Crop,
    min: number,
    max: number,
    step: number
  ) => (
    <label className="flex flex-col gap-1">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={crop[field]}
        onChange={(event) =>
          setCrop({ ...crop, [field]: Number(event.target.value) })
        }
      />
    </label>
  );

  return (
    <section
      aria-label={t.cropTitle}
      className="flex max-w-xl flex-col gap-3 rounded-lg border border-petroleo/20 p-4"
    >
      <h3 className="text-lg font-semibold">{t.cropTitle}</h3>
      <label className="flex flex-col gap-1">
        {t.choose}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => void choose(event)}
        />
      </label>
      {error && <output className="block text-red-800">{error}</output>}
      {image && (
        <>
          <figure className="flex flex-col gap-1">
            <canvas
              ref={preview}
              aria-hidden="true"
              width={PREVIEW_SIDE}
              height={PREVIEW_SIDE}
              className="size-60 rounded-md border border-petroleo/30"
            />
            <figcaption className="text-sm">{t.preview}</figcaption>
          </figure>
          {slider(t.zoom, 'zoom', 1, 4, 0.05)}
          {slider(t.horizontal, 'x', 0, 1, 0.01)}
          {slider(t.vertical, 'y', 0, 1, 0.01)}
          <label className="flex flex-col gap-1">
            {t.size}
            <select
              value={width}
              onChange={(event) =>
                setWidth(Number(event.target.value) as typeof width)
              }
              className="min-h-11 rounded-md border border-petroleo/30 bg-white px-3"
            >
              {OUTPUT_WIDTHS.map((option) => (
                <option key={option} value={option}>
                  {t.sizes[String(option) as keyof typeof t.sizes]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void upload(image)}
            className="tap-target self-start rounded-lg bg-petroleo px-5 font-semibold text-marfil disabled:opacity-60"
          >
            {busy ? t.uploading : t.upload}
          </button>
        </>
      )}
      <button
        type="button"
        onClick={onCancel}
        className="tap-target self-start underline"
      >
        {t.cancel}
      </button>
    </section>
  );
}
