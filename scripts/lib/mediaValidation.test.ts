import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MEDIA_CACHE_CONTROL,
  MEDIA_MAX_BYTES,
  mediaResponseHeaders,
  mediaViolations,
  sniffImage,
} from './mediaValidation';

const sha = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

/** A JPEG header: SOI, one APP0 segment, then a baseline SOF0 with the given size. */
function jpeg(width: number, height: number, frame = 0xc0): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    frame,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
  ]);
}

/** A RIFF/WEBP container whose first chunk header and payload are given. */
function webp(chunk: string, payload: number[]): Uint8Array {
  const body = [...'WEBP', ...chunk].map((c) => c.charCodeAt(0));
  const bytes = [...'RIFF'].map((c) => c.charCodeAt(0));
  return Uint8Array.from([
    ...bytes,
    0,
    0,
    0,
    0,
    ...body,
    0,
    0,
    0,
    0,
    ...payload,
    ...Array(16).fill(0),
  ]);
}

const vp8x = (w: number, h: number) =>
  webp('VP8X', [
    0,
    0,
    0,
    0,
    (w - 1) & 0xff,
    ((w - 1) >> 8) & 0xff,
    0,
    (h - 1) & 0xff,
    ((h - 1) >> 8) & 0xff,
    0,
  ]);
const vp8 = (w: number, h: number) =>
  webp('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, w & 0xff, w >> 8, h & 0xff, h >> 8]);
function vp8l(w: number, h: number): Uint8Array {
  const bits = (w - 1) | ((h - 1) << 14);
  return webp('VP8L', [
    0x2f,
    bits & 0xff,
    (bits >> 8) & 0xff,
    (bits >> 16) & 0xff,
    (bits >>> 24) & 0xff,
  ]);
}

describe('sniffImage (ADR 0012: the bytes decide, not the client)', () => {
  it('reads the size of a JPEG from its start-of-frame segment, skipping others', () => {
    expect(sniffImage(jpeg(1200, 900))).toEqual({
      mime: 'image/jpeg',
      width: 1200,
      height: 900,
    });
    expect(sniffImage(jpeg(300, 300, 0xc2))).toMatchObject({ width: 300 });
  });

  it('does not take a Huffman table segment for a frame', () => {
    expect(sniffImage(jpeg(600, 600, 0xc4))).toBeNull();
  });

  it('reads the size of the three WebP flavours', () => {
    expect(sniffImage(vp8x(1200, 800))).toEqual({
      mime: 'image/webp',
      width: 1200,
      height: 800,
    });
    expect(sniffImage(vp8(600, 450))).toEqual({
      mime: 'image/webp',
      width: 600,
      height: 450,
    });
    expect(sniffImage(vp8l(300, 200))).toEqual({
      mime: 'image/webp',
      width: 300,
      height: 200,
    });
  });

  it('refuses SVG, markup, PNG, truncated or unknown containers', () => {
    const text = (s: string) => new TextEncoder().encode(s);
    expect(
      sniffImage(
        text('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')
      )
    ).toBeNull();
    expect(sniffImage(text('<!doctype html><p>x</p>'))).toBeNull();
    expect(
      sniffImage(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      )
    ).toBeNull();
    expect(sniffImage(webp('VP8X', []).subarray(0, 20))).toBeNull();
    expect(sniffImage(webp('ALPH', [1, 2, 3]))).toBeNull();
    expect(sniffImage(webp('VP8 ', [0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(sniffImage(webp('VP8L', [0x00]))).toBeNull();
  });
});

describe('mediaViolations (FC 027 T2.3)', () => {
  it('accepts each of the three derivative widths in WebP or JPEG', () => {
    for (const bytes of [vp8x(1200, 1200), vp8(600, 600), jpeg(300, 300)]) {
      const mime = sniffImage(bytes)?.mime ?? '';
      expect(
        mediaViolations({ bytes, declaredMime: mime, sha256: sha(bytes) })
      ).toEqual([]);
    }
  });

  it('refuses an SVG even when it is declared as an image', () => {
    const bytes = new TextEncoder().encode('<svg onload="alert(1)"/>');
    expect(
      mediaViolations({ bytes, declaredMime: 'image/webp', sha256: sha(bytes) })
    ).toEqual(['not a WebP or JPEG image (SVG and markup are refused)']);
  });

  it('refuses a mismatched type, a width outside the derivatives and a wrong hash', () => {
    const bytes = jpeg(800, 600);
    expect(
      mediaViolations({
        bytes,
        declaredMime: 'image/webp',
        sha256: 'f'.repeat(64),
      })
    ).toEqual([
      'declared image/webp but the bytes are image/jpeg',
      'width 800 is not one of 1200, 600, 300',
      'sha256 does not match the bytes',
    ]);
  });

  it('refuses a payload larger than a MEDIUMBLOB', () => {
    const bytes = new Uint8Array(MEDIA_MAX_BYTES + 1);
    bytes.set(vp8(600, 600));
    expect(
      mediaViolations({ bytes, declaredMime: 'image/webp', sha256: sha(bytes) })
    ).toEqual([`${MEDIA_MAX_BYTES + 1} bytes exceed the MEDIUMBLOB limit`]);
  });
});

describe('mediaResponseHeaders (ADR 0012 §5)', () => {
  it('caches for a year as immutable, with the hash as strong ETag and no sniffing', () => {
    expect(
      mediaResponseHeaders({ mime: 'image/webp', sha256: 'a'.repeat(64) })
    ).toEqual({
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: `"${'a'.repeat(64)}"`,
      'X-Content-Type-Options': 'nosniff',
    });
    expect(MEDIA_CACHE_CONTROL).toBe('public, max-age=31536000, immutable');
  });
});
