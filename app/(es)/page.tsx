import { HomeView } from '@/components/views/HomeView';
import { pageMetadata } from '@/lib/routes';

export const metadata = pageMetadata('home', 'es-MX');

export default function Page() {
  return <HomeView locale="es-MX" />;
}
