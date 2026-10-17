import { OfflineView } from '@/components/views/OfflineView';
import { pageMetadata } from '@/lib/routes';

export const metadata = {
  ...pageMetadata('offline', 'es-MX'),
  robots: { index: false, follow: false },
};

export default function Page() {
  return <OfflineView locale="es-MX" />;
}
