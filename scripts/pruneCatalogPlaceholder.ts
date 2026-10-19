/**
 * Deletes the empty-catalog placeholder page from out/ after `next build` (FC 008 F3).
 *
 * Next's static export cannot build a dynamic route with zero params, so an empty catalog
 * prerenders one placeholder product page (lib/catalog/snapshot, PLACEHOLDER_SLUG). Left in out/,
 * Apache would serve that 404 body with status 200 (a soft 404). Deleted, the path gets the
 * site's real 404. Exits 1 if a placeholder survives. CLI: run by `bun run build`.
 *
 * @module
 */
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { locales } from '@/app/i18n';
import { PLACEHOLDER_SLUG } from '@/lib/catalog/snapshot';
import { productPath } from '@/lib/routes';

const placeholders = locales.map((locale) =>
  join('out', productPath(PLACEHOLDER_SLUG, locale))
);
for (const dir of placeholders) rmSync(dir, { recursive: true, force: true });

const survivors = placeholders.filter((dir) => existsSync(dir));
if (survivors.length > 0) {
  console.error(
    `[FAIL] placeholder pages left in out/: ${survivors.join(', ')}`
  );
  process.exit(1);
}
console.log('[OK] no catalog placeholder page in out/.');
