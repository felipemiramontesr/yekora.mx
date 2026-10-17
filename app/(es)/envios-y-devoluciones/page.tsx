import { ShippingReturnsView } from '@/components/views/ShippingReturnsView';
import { pageMetadata } from '@/lib/routes';

export const metadata = pageMetadata('shipping', 'es-MX');

export default function Page() {
  return <ShippingReturnsView locale="es-MX" />;
}
