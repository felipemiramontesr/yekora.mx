import { LegalView } from '@/components/views/LegalView';
import { pageMetadata } from '@/lib/routes';

export const metadata = pageMetadata('terms', 'es-MX');

export default function Page() {
  return <LegalView locale="es-MX" document="terms" />;
}
