import { CatalogView } from '@/components/views/CatalogView';
import { loadSnapshot } from '@/lib/catalog/snapshot';
import { pageMetadata } from '@/lib/routes';

export const metadata = pageMetadata('catalog', 'en');

export default function Page() {
  return <CatalogView locale="en" snapshot={loadSnapshot()} />;
}
