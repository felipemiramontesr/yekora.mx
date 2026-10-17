/**
 * FC 005 · Tier 2 invariant I-AntiPending (Ω's rule: the site shows no pending item).
 *
 *   ∀ f ∈ {messages/es-MX.json, messages/en.json} :
 *     ¬Contains(f, "Pendiente") ∧ ¬Contains(f, "Pending") ∧ ¬HasProperty(f, "draftNotice")
 *
 * The check walks every key and string of both dictionaries. It is case-sensitive on purpose:
 * the capitalized words are the placeholder markers, while lowercase "pendiente" (a slope) is
 * legitimate outdoor vocabulary. Anything still pending belongs in the local backlog (K-20).
 */
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import esMX from '@/messages/es-MX.json';

const MARKERS = ['Pendiente', 'Pending'];

/** Every object key and string value under `node`, depth first. */
function texts(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) => [
      key,
      ...texts(value),
    ]);
  }
  return [];
}

describe.each([
  ['es-MX', esMX],
  ['en', en],
] as const)('I-AntiPending · messages/%s.json', (_locale, dictionary) => {
  const all = texts(dictionary);

  it('walks the whole dictionary', () => {
    expect(all.length).toBeGreaterThan(100);
  });

  it.each(MARKERS)('contains no "%s" marker', (marker) => {
    expect(all.filter((text) => text.includes(marker))).toEqual([]);
  });

  it('has no draft notice', () => {
    expect(all).not.toContain('draftNotice');
  });
});

describe('the marker detector itself', () => {
  it('finds markers in nested keys and values, and ignores the lowercase word', () => {
    const found = texts({
      a: ['ok', { draftNotice: 'x' }],
      b: 'una pendiente',
    });
    expect(found).toContain('draftNotice');
    expect(found.some((text) => MARKERS.some((m) => text.includes(m)))).toBe(
      false
    );
    expect(texts({ c: '[Pendiente: x]' })).toContain('[Pendiente: x]');
    expect(texts(42)).toEqual([]);
  });
});
