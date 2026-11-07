/**
 * Product media stored in MariaDB (FC 029, ADR 0012): one row of `media_blobs` per image,
 * addressed by the SHA-256 of its bytes.
 *
 * F1 only reads. Ingestion (no SVG, WebP/JPEG/PNG signature equal to the declared type, at most
 * 2 MB, canonical widths) arrives in F2 together with the upload route that uses it, so this
 * module never exports code without a caller (DC4, 308_AN / 309_AN).
 *
 * @module
 */
import { createHash } from 'node:crypto';
import type { Db } from './db';

/** A SHA-256 digest as `media_blobs` stores it: 64 lowercase hex characters. */
export const SHA256_HEX = /^[0-9a-f]{64}$/;

/** One stored image: its type and its bytes. */
interface StoredMedia {
  /** MIME type stored with the blob (image/webp, image/jpeg or image/png; CHECK of migration 006). */
  mimeType: string;
  /** The bytes, exactly as stored. */
  data: Buffer;
}

/**
 * Reads one image by its digest.
 *
 * @param db - Database port.
 * @param sha256 - Digest of the bytes (already validated by the route).
 * @returns The image, or null when no blob has that digest.
 */
export async function readMedia(
  db: Db,
  sha256: string
): Promise<StoredMedia | null> {
  const [row] = await db.query<{ mime_type: string; media_data: Buffer }>(
    'SELECT mime_type, media_data FROM media_blobs WHERE sha256 = ?',
    [sha256]
  );
  return row ? { mimeType: row.mime_type, data: row.media_data } : null;
}

/**
 * Whether bytes really hash to the digest they are served under (T2.2c): a blob altered in the
 * database, or a row whose key no longer matches its content, is never sent as that image.
 *
 * @param data - The bytes about to be sent.
 * @param sha256 - The digest in the route.
 * @returns True when SHA-256(data) equals the digest.
 */
export function matchesDigest(data: Buffer, sha256: string): boolean {
  return createHash('sha256').update(data).digest('hex') === sha256;
}
