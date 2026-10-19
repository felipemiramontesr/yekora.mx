/**
 * Prepares the catalog snapshot before `next build` (FC 008 F3). Three sources, one at a time:
 *
 * - `CATALOG_API_URL` — reads both languages from the API (deploy, from F5; local API in dev);
 * - `CATALOG_FIXTURE` — copies a validated fixture (E2E job only; the deploy job fails if a
 *   fixture product ever reaches out/);
 * - neither — an empty catalog: the site shows «Próximamente» (production until K-07).
 *
 * Any failure exits 1, so the build stops and the deployed site stays as it was: never a
 * partial catalog. CLI: `bun scripts/buildCatalog.ts` (run by `bun run build`).
 *
 * @module
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fetchCatalog, isAllowedApiBase } from '@/lib/api/catalogClient';
import {
  EMPTY_SNAPSHOT,
  parseSnapshot,
  SNAPSHOT_FILE,
  snapshotFrom,
  type CatalogSnapshot,
} from '@/lib/catalog/snapshot';

const api = process.env.CATALOG_API_URL;
const fixture = process.env.CATALOG_FIXTURE;

async function readSnapshot(): Promise<{
  snapshot: CatalogSnapshot;
  source: string;
}> {
  if (api && fixture) {
    throw new Error('Set CATALOG_API_URL or CATALOG_FIXTURE, not both.');
  }
  if (fixture) {
    return {
      snapshot: parseSnapshot(JSON.parse(readFileSync(fixture, 'utf8'))),
      source: `fixture ${fixture}`,
    };
  }
  if (api) {
    if (!isAllowedApiBase(api)) {
      throw new Error(
        'CATALOG_API_URL must be https (http only on localhost).'
      );
    }
    const [es, en] = await Promise.all([
      fetchCatalog(api, 'es-MX'),
      fetchCatalog(api, 'en'),
    ]);
    return { snapshot: snapshotFrom(es, en), source: `API ${api}` };
  }
  return { snapshot: EMPTY_SNAPSHOT, source: 'empty (no CATALOG_API_URL)' };
}

try {
  const { snapshot, source } = await readSnapshot();
  mkdirSync(dirname(SNAPSHOT_FILE), { recursive: true });
  writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot));
  console.log(
    `[OK] catalog snapshot: ${snapshot.products['es-MX'].length} product(s) · FIX ${snapshot.exchangeRate?.date ?? 'none'} · ${source}`
  );
} catch (error) {
  console.error(`[FAIL] catalog snapshot: ${(error as Error).message}`);
  process.exit(1);
}
