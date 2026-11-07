import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Db } from './db';
import { matchesDigest, readMedia, SHA256_HEX } from './media';

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
