import { AboutView } from '@/components/views/AboutView';
import { pageMetadata } from '@/lib/routes';

export const metadata = pageMetadata('about', 'es-MX');

export default function Page() {
  return <AboutView locale="es-MX" />;
}
