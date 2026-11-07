/**
 * Image signature and size probe (FC 029 F2, T1.2 M and D): reads the type and the pixel
 * dimensions of a WebP, JPEG or PNG from its own header bytes, never from what the client says.
 *
 * Anything else, SVG included, has no signature here and is unsafe by construction (T2.2b): the
 * probe never parses XML or text, so a script inside an "image" is never even looked at.
 *
 * @module
 */

import type { SafeImageType } from '../../../../lib/catalog/adminTypes';

/** What the header says: the real type and the pixel size. */
interface ImageProbe {
  /** Type from the signature bytes. */
  type: SafeImageType;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Whether `bytes` starts with `prefix` at `offset`. */
function startsWith(
  bytes: Buffer,
  prefix: readonly number[],
  offset = 0
): boolean {
  return prefix.every((byte, index) => bytes[offset + index] === byte);
}

/** PNG: signature, then the IHDR chunk carries width and height (big-endian). */
function probePng(bytes: Buffer): ImageProbe | null {
  if (bytes.length < 24 || !startsWith(bytes, PNG_SIGNATURE)) return null;
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  return {
    type: 'image/png',
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

/** JPEG start-of-frame markers (SOF0–SOF15 except DHT C4, JPG C8 and DAC CC). */
function isStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

/** JPEG: SOI, then segments until a start-of-frame, which carries height and width. */
function probeJpeg(bytes: Buffer): ImageProbe | null {
  if (!startsWith(bytes, [0xff, 0xd8, 0xff])) return null;
  let offset = 2;
  while (offset + 9 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (isStartOfFrame(marker)) {
      return {
        type: 'image/jpeg',
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  return null;
}

/** WebP: RIFF container, then a VP8 (lossy), VP8L (lossless) or VP8X (extended) chunk. */
function probeWebp(bytes: Buffer): ImageProbe | null {
  if (bytes.length < 30) return null;
  if (bytes.toString('latin1', 0, 4) !== 'RIFF') return null;
  if (bytes.toString('latin1', 8, 12) !== 'WEBP') return null;
  const chunk = bytes.toString('latin1', 12, 16);
  if (chunk === 'VP8 ' && startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) {
    return {
      type: 'image/webp',
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return {
      type: 'image/webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === 'VP8X') {
    return {
      type: 'image/webp',
      width: bytes.readUIntLE(24, 3) + 1,
      height: bytes.readUIntLE(27, 3) + 1,
    };
  }
  return null;
}

/**
 * Reads the real type and size of an image from its bytes.
 *
 * @param bytes - The uploaded bytes.
 * @returns Type and dimensions, or null when they are not a WebP, JPEG or PNG.
 */
export function probeImage(bytes: Buffer): ImageProbe | null {
  return probePng(bytes) ?? probeJpeg(bytes) ?? probeWebp(bytes);
}
