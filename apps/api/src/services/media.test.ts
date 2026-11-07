import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Db } from './db';
import { inspectMedia, matchesDigest, readMedia, storeMedia } from './media';
import { SHA256_HEX } from '../../../../lib/catalog/adminTypes';

const bytes = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1');
const digest = createHash('sha256').update(bytes).digest('hex');

/** Db port that answers one statement and records what it received. */
function oneAnswer(rows: unknown[]) {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const db: Db = {
    async query<Row>(sql: string, params: readonly unknown[] = []) {
      calls.push({ sql, params });
      return rows as Row[];
    },
    ping: async () => undefined,
    close: async () => undefined,
  };
  return { db, calls };
}

describe('readMedia (FC 029 F1)', () => {
  it('reads one blob by its digest, bound as a parameter', async () => {
    const { db, calls } = oneAnswer([
      { mime_type: 'image/webp', media_data: bytes },
    ]);
    await expect(readMedia(db, digest)).resolves.toEqual({
      mimeType: 'image/webp',
      data: bytes,
    });
    expect(calls).toEqual([
      {
        sql: 'SELECT mime_type, media_data FROM media_blobs WHERE sha256 = ?',
        params: [digest],
      },
    ]);
  });

  it('answers null when no blob has that digest', async () => {
    await expect(readMedia(oneAnswer([]).db, digest)).resolves.toBeNull();
  });
});

describe('matchesDigest (T2.2c)', () => {
  it('accepts bytes that hash to the digest and refuses any other', () => {
    expect(matchesDigest(bytes, digest)).toBe(true);
    expect(matchesDigest(Buffer.from('other'), digest)).toBe(false);
  });
});

describe('SHA256_HEX', () => {
  it('admits only 64 lowercase hex characters', () => {
    expect(SHA256_HEX.test(digest)).toBe(true);
    expect(SHA256_HEX.test(digest.toUpperCase())).toBe(false);
    expect(SHA256_HEX.test(digest.slice(1))).toBe(false);
    expect(SHA256_HEX.test(`${digest}0`)).toBe(false);
  });
});

/** A PNG of the given size; `padding` grows the file without changing the header. */
function png(width: number, height: number, padding = 0): Buffer {
  const bytes = Buffer.alloc(33 + padding);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

describe('inspectMedia (T1.2: Ingested ⟺ M ∧ S ∧ D)', () => {
  it('accepts a PNG of a canonical width, declared as PNG, and names its digest', () => {
    const image = png(600, 400);
    expect(inspectMedia(image, 'image/png')).toEqual({
      code: 'MEDIA_ACCEPTED',
      sha256: createHash('sha256').update(image).digest('hex'),
      mimeType: 'image/png',
      width: 600,
      height: 400,
      sizeBytes: image.length,
    });
  });

  it('refuses SVG, an unknown signature or a type other than declared (M = ⊥)', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(inspectMedia(svg, 'image/svg+xml').code).toBe('MEDIA_UNSAFE_TYPE');
    expect(inspectMedia(svg, 'image/png').code).toBe('MEDIA_UNSAFE_TYPE');
    expect(inspectMedia(png(600, 400), 'image/webp').code).toBe(
      'MEDIA_UNSAFE_TYPE'
    );
  });

  it('names the type first when both the type and the size are wrong', () => {
    const huge = Buffer.alloc(2_097_153, 0x20);
    expect(inspectMedia(huge, 'image/png').code).toBe('MEDIA_UNSAFE_TYPE');
  });

  it('refuses more than 2 MB, even with valid dimensions (S = ⊥)', () => {
    expect(inspectMedia(png(1200, 1200, 2_097_152), 'image/png').code).toBe(
      'MEDIA_SIZE_EXCEEDED'
    );
    expect(
      inspectMedia(png(1200, 1200, 2_097_152 - 33), 'image/png').code
    ).toBe('MEDIA_ACCEPTED');
  });

  it('names the size before the dimensions when both are wrong', () => {
    expect(inspectMedia(png(1000, 1200, 2_097_152), 'image/png').code).toBe(
      'MEDIA_SIZE_EXCEEDED'
    );
  });

  it.each([
    [1000, 600],
    [1200, 0],
    [300, 1201],
  ])(
    'refuses %i × %i px: only widths 1200, 600 or 300 and heights up to 1200 (D = ⊥)',
    (width, height) => {
      expect(inspectMedia(png(width, height), 'image/png').code).toBe(
        'MEDIA_DIMENSIONS_INVALID'
      );
    }
  );
});

describe('storeMedia (T2.2a: one row per digest)', () => {
  const image = png(300, 300);
  const verdict = inspectMedia(image, 'image/png') as Extract<
    ReturnType<typeof inspectMedia>,
    { code: 'MEDIA_ACCEPTED' }
  >;

  it('inserts a new digest with its type, size and bytes', async () => {
    const { db, calls } = oneAnswer([]);
    await expect(storeMedia(db, image, verdict)).resolves.toBe(true);
    expect(calls[0].sql).toContain('FOR UPDATE');
    expect(calls[1].params).toEqual([
      verdict.sha256,
      'image/png',
      300,
      300,
      image.length,
      image,
    ]);
  });

  it('leaves an existing digest as it is', async () => {
    const { db, calls } = oneAnswer([{ sha256: verdict.sha256 }]);
    await expect(storeMedia(db, image, verdict)).resolves.toBe(false);
    expect(calls).toHaveLength(1);
  });
});
