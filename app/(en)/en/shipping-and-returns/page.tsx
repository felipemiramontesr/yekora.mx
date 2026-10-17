import { ShippingReturnsView } from '@/components/views/ShippingReturnsView';
import { pageMetadata } from '@/lib/routes';

export const metadata = pageMetadata('shipping', 'en');

export default function Page() {
  return <ShippingReturnsView locale="en" />;
}
