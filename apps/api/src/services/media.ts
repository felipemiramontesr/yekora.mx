/**
 * Product media stored in MariaDB (FC 029, ADR 0012): one row of `media_blobs` per image,
 * addressed by the SHA-256 of its bytes.
 *
 * F1 reads (`GET /v1/media/:sha256`). F2 ingests (T1.2, T2.2a, T2.2b): the signature in the
 * bytes must be a WebP, JPEG or PNG equal to the declared type (never SVG), at most 2 MB, with a
 * canonical width of 1200, 600 or 300 px from the browser's Canvas crop; the blob is stored once
 * per digest, whoever uploads it again.
 *
 * @module
 */
import { createHash } from 'node:crypto';
import type { Db, TxQuery } from './db';
import type { SafeImageType } from '../../../../lib/catalog/adminTypes';
import { probeImage } from './imageProbe';

/** Largest image the store accepts: 2 MB (T1.2 S, CHECK `ck_media_blobs_size`). */
const MAX_MEDIA_BYTES = 2_097_152;

/** Widths of the browser's Canvas crop: large, catalog, thumbnail (T1.2 D). */
const CANONICAL_WIDTHS = new Set([1200, 600, 300]);

/** Tallest image accepted: the large width, so a crop never becomes a banner of any length. */
const MAX_HEIGHT = 1200;

/** Outcome of an upload, as T1.2 names it. */
type MediaVerdict =
  | {
      code: 'MEDIA_ACCEPTED';
      sha256: string;
      mimeType: SafeImageType;
      width: number;
      height: number;
      sizeBytes: number;
    }
  | {
      code:
        | 'MEDIA_UNSAFE_TYPE'
        | 'MEDIA_SIZE_EXCEEDED'
        | 'MEDIA_DIMENSIONS_INVALID';
    };

/**
 * Judges an upload without storing it (T1.2): Ingested ⟺ M ∧ S ∧ D, and the code of a refusal
 * follows the table's priority, the type first, then the size, then the dimensions.
 *
 * @param bytes - The uploaded bytes.
 * @param declaredType - The Content-Type the client sent.
 * @returns MEDIA_ACCEPTED with the digest and the probed size, or the code of the refusal.
 */
export function inspectMedia(
  bytes: Buffer,
  declaredType: string
): MediaVerdict {
  const probe = probeImage(bytes);
  if (probe?.type !== declaredType) return { code: 'MEDIA_UNSAFE_TYPE' };
  if (bytes.length > MAX_MEDIA_BYTES) return { code: 'MEDIA_SIZE_EXCEEDED' };
  if (
    !CANONICAL_WIDTHS.has(probe.width) ||
    probe.height < 1 ||
    probe.height > MAX_HEIGHT
  ) {
    return { code: 'MEDIA_DIMENSIONS_INVALID' };
  }
  return {
    code: 'MEDIA_ACCEPTED',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    mimeType: probe.type,
    width: probe.width,
    height: probe.height,
    sizeBytes: bytes.length,
  };
}

/**
 * Stores an accepted image once per digest (T2.2a): a second upload of the same bytes leaves the
 * first row as it is.
 *
 * @param tx - The transaction of the upload (with its idempotency row and audit entry).
 * @param bytes - The bytes {@link inspectMedia} accepted.
 * @param verdict - Its MEDIA_ACCEPTED verdict.
 * @returns True when this upload created the blob; false when it already existed.
 */
export async function storeMedia(
  tx: TxQuery,
  bytes: Buffer,
  verdict: Extract<MediaVerdict, { code: 'MEDIA_ACCEPTED' }>
): Promise<boolean> {
  const [existing] = await tx.query<{ sha256: string }>(
    'SELECT sha256 FROM media_blobs WHERE sha256 = ? FOR UPDATE',
    [verdict.sha256]
  );
  if (existing) return false;
  await tx.query(
    'INSERT INTO media_blobs (sha256, mime_type, width, height, size_bytes, media_data) VALUES (?, ?, ?, ?, ?, ?)',
    [
      verdict.sha256,
      verdict.mimeType,
      verdict.width,
      verdict.height,
      verdict.sizeBytes,
      bytes,
    ]
  );
  return true;
}

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
