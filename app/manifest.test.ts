import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest, { dynamic } from './manifest';

describe('manifest (FC 007, T1.2 · M ∧ I)', () => {
  const data = manifest();

  it('is installable: start URL, scope, standalone display and brand colors', () => {
    expect(data).toMatchObject({
      name: 'YĒKORA | Tienda Outdoor',
      short_name: 'YĒKORA',
      lang: 'es-MX',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      orientation: 'any',
      theme_color: '#213C41',
      background_color: '#F8F5EE',
    });
    expect(data.description).toContain('Marcas mexicanas');
  });

  it('declares 192 and 512 icons in both purposes, and every icon file exists', () => {
    const icons = data.icons ?? [];
    for (const purpose of ['any', 'maskable'] as const) {
      for (const sizes of ['192x192', '512x512']) {
        expect(icons).toContainEqual(
          expect.objectContaining({ sizes, purpose })
        );
      }
    }
    for (const icon of icons)
      expect(existsSync(`public${icon.src}`)).toBe(true);
  });

  it('is rendered once at build time, as the static export requires', () => {
    expect(dynamic).toBe('force-static');
  });
});
