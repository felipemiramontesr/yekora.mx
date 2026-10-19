import { CatalogView } from '@/components/views/CatalogView';
import { loadSnapshot } from '@/lib/catalog/snapshot';
import { pageMetadata } from '@/lib/routes';

export const metadata = pageMetadata('catalog', 'es-MX');

export default function Page() {
  return <CatalogView locale="es-MX" snapshot={loadSnapshot()} />;
}
