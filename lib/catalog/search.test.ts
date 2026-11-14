import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/api/catalogClient';
import { matchEntries, searchIndexOf } from './search';

const ENTRIES = [
  {
    slug: 'a',
    name: 'Arnés alpino',
    discipline: 'escalada',
    disciplineName: 'Escalada',
  },
  {
    slug: 'b',
    name: 'Mochila ligera 28 L',
    discipline: 'senderismo',
    disciplineName: 'Senderismo',
  },
  {
    slug: 'c',
    name: 'Casco de montaña',
    discipline: 'montana',
    disciplineName: 'Montaña',
  },
  {
    slug: 'd',
    name: 'Tenis de trail',
    discipline: 'trail-running',
    disciplineName: 'Trail running',
  },
];

describe('product search (FC 047 T0.2, T1.2)', () => {
  it('keeps only what a suggestion shows: no price, no stock', () => {
    const product = {
      slug: 'x',
      name: 'X',
      discipline: 'd',
      disciplineName: 'D',
      priceMxnCents: 100,
      inStock: true,
    } as unknown as Product;
    expect(searchIndexOf([product])).toEqual([
      { slug: 'x', name: 'X', discipline: 'd', disciplineName: 'D' },
    ]);
  });

  it('compares without accents or capitals', () => {
    expect(matchEntries(ENTRIES, 'MONTANA').map((e) => e.slug)).toEqual(['c']);
    expect(matchEntries(ENTRIES, 'arnes').map((e) => e.slug)).toEqual(['a']);
  });

  it('finds by a word of the name or by the discipline, every word of the query being needed', () => {
    expect(matchEntries(ENTRIES, 'ligera 28').map((e) => e.slug)).toEqual([
      'b',
    ]);
    expect(matchEntries(ENTRIES, 'trail running').map((e) => e.slug)).toEqual([
      'd',
    ]);
    expect(matchEntries(ENTRIES, 'senderismo').map((e) => e.slug)).toEqual([
      'b',
    ]);
    expect(matchEntries(ENTRIES, 'mochila casco')).toEqual([]);
  });

  it('orders by how well each answers: name start, word start, anywhere; then by name', () => {
    const entries = [
      {
        slug: '1',
        name: 'Bastón de trekking',
        discipline: 'x',
        disciplineName: 'Montaña',
      },
      {
        slug: '2',
        name: 'Guantes',
        discipline: 'x',
        disciplineName: 'Trekking',
      },
      { slug: '3', name: 'Trekking pro', discipline: 'x', disciplineName: 'X' },
      {
        slug: '4',
        name: 'Mini trekking',
        discipline: 'x',
        disciplineName: 'X',
      },
      { slug: '5', name: 'Camiseta', discipline: 'x', disciplineName: 'X' },
    ];
    expect(matchEntries(entries, 'trek').map((e) => e.slug)).toEqual([
      '3',
      '1',
      '4',
      '2',
    ]);
    expect(matchEntries(entries, 'ekk').map((e) => e.slug)).toEqual([
      '1',
      '2',
      '4',
      '3',
    ]);
  });

  it('gives nothing for an empty query and respects the limit', () => {
    expect(matchEntries(ENTRIES, '   ')).toEqual([]);
    expect(matchEntries(ENTRIES, 'a', 2)).toHaveLength(2);
  });
});
