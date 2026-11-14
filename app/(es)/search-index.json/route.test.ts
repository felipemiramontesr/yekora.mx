import { describe, expect, it } from 'vitest';
import { GET as english } from '../../(en)/en/search-index.json/route';
import { GET as spanish } from './route';

describe('product search index (FC 047 T0.2)', () => {
  it('serves a list of name, slug and discipline per language, and nothing else', async () => {
    for (const get of [spanish, english]) {
      const entries = (await get().json()) as Record<string, unknown>[];
      expect(Array.isArray(entries)).toBe(true);
      for (const entry of entries) {
        expect(Object.keys(entry).sort()).toEqual([
          'discipline',
          'disciplineName',
          'name',
          'slug',
        ]);
      }
    }
  });
});
