/**
 * Media rules of ADR 0012 (FC 027 T2.3), ready for the upload route of FC 029: what a stored
 * image must be, judged from its bytes and never from what the browser claims.
 *
 * An upload is accepted only if its magic bytes are WebP or JPEG (SVG, HTML or anything else is
 * refused), the declared MIME type matches them, it fits a MEDIUMBLOB, its width is one of the
 * three derivatives (1200, 600, 300 px) and its SHA-256 is the one it is stored under. The answer
 * of `GET /v1/media/:sha256` is cached for a year as immutable, with the hash as its ETag.
 *
 * @module
 */
import { createHash } from 'node:crypto';

/** Widths the browser crop tool derives; nothing else is stored. */
export const MEDIA_WIDTHS = [1200, 600, 300] as const;

/** Capacity of a MariaDB MEDIUMBLOB, in bytes. */
export const MEDIA_MAX_BYTES = 16_777_215;

/** The only image types the API stores. */
export const MEDIA_MIME_TYPES = ['image/webp', 'image/jpeg'] as const;

/** Cache policy of every stored image: its URL is its hash, so it never changes. */
export const MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Type and size of an image, read from its own bytes. */
export interface SniffedImage {
  mime: (typeof MEDIA_MIME_TYPES)[number];
  width: number;
  height: number;
}

/** One upload as the API receives it. */
export interface MediaUpload {
  /** The binary payload. */
  bytes: Uint8Array;
  /** The type the client declared. */
  declaredMime: string;
  /** The hash the client says identifies it (64 hex characters). */
  sha256: string;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) =>
  b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, to));

/** Start-of-frame markers that carry the image size (not DHT C4, JPG C8 or DAC CC). */
const isStartOfFrame = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

/** Size of a JPEG, from its first start-of-frame segment. */
function jpegSize(b: Uint8Array): SniffedImage | null {
  let i = 2;
  while (i + 9 < b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (isStartOfFrame(marker)) {
      return {
        mime: 'image/jpeg',
        height: u16be(b, i + 5),
        width: u16be(b, i + 7),
      };
    }
    i += 2 + u16be(b, i + 2);
  }
  return null;
}

/** Size of a WebP, from its VP8X, VP8 (lossy) or VP8L (lossless) chunk. */
function webpSize(b: Uint8Array): SniffedImage | null {
  if (b.length < 30) return null;
  const chunk = ascii(b, 12, 16);
  const size = (width: number, height: number): SniffedImage => ({
    mime: 'image/webp',
    width,
    height,
  });
  if (chunk === 'VP8X') return size(u24le(b, 24) + 1, u24le(b, 27) + 1);
  if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)
    return size(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  if (chunk === 'VP8L' && b[20] === 0x2f) {
    const bits = u16le(b, 21) | (u16le(b, 23) << 16);
    return size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  return null;
}

/**
 * Reads the type and size of an image from its magic bytes.
 *
 * @param bytes - The binary payload.
 * @returns WebP or JPEG with its size, or null for anything else (SVG and markup included).
 */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return jpegSize(bytes);
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP')
    return webpSize(bytes);
  return null;
}

/**
 * Judges one upload against ADR 0012 (T2.3).
 *
 * @param upload - Bytes, declared type and claimed hash.
 * @returns One message per broken rule; empty when the image may be stored.
 */
export function mediaViolations(upload: MediaUpload): string[] {
  const { bytes, declaredMime, sha256 } = upload;
  const violations: string[] = [];
  const image = sniffImage(bytes);
  if (image === null) {
    violations.push('not a WebP or JPEG image (SVG and markup are refused)');
  } else {
    if (image.mime !== declaredMime)
      violations.push(
        `declared ${declaredMime} but the bytes are ${image.mime}`
      );
    if (!(MEDIA_WIDTHS as readonly number[]).includes(image.width))
      violations.push(
        `width ${image.width} is not one of ${MEDIA_WIDTHS.join(', ')}`
      );
  }
  if (bytes.length > MEDIA_MAX_BYTES)
    violations.push(`${bytes.length} bytes exceed the MEDIUMBLOB limit`);
  if (createHash('sha256').update(bytes).digest('hex') !== sha256)
    violations.push('sha256 does not match the bytes');
  return violations;
}

/**
 * Headers of `GET /v1/media/:sha256` (ADR 0012 §5).
 *
 * @param image - The stored type and its hash.
 * @returns Content type, immutable year-long cache and the hash as a strong ETag.
 */
export function mediaResponseHeaders(image: {
  mime: SniffedImage['mime'];
  sha256: string;
}): Record<string, string> {
  return {
    'Content-Type': image.mime,
    'Cache-Control': MEDIA_CACHE_CONTROL,
    ETag: `"${image.sha256}"`,
    'X-Content-Type-Options': 'nosniff',
  };
}
