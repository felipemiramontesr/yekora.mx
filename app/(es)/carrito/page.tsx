import { CartView } from '@/components/views/CartView';
import { pageMetadata } from '@/lib/routes';

// The cart lives in each visitor's browser: nothing here for search engines.
export const metadata = {
  ...pageMetadata('cart', 'es-MX'),
  robots: { index: false, follow: false },
};

export default function Page() {
  return <CartView locale="es-MX" />;
}
