import { searchIndexOf } from '@/lib/catalog/search';
import { loadSnapshot } from '@/lib/catalog/snapshot';

/** The static export writes this file at build time (FC 047 T0.2). */
export const dynamic = 'force-static';

/** The product search index in Spanish: name, slug and discipline of each product, nothing more. */
export function GET() {
  return Response.json(searchIndexOf(loadSnapshot().products['es-MX']));
}
