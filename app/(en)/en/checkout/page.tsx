import { CheckoutView } from '@/components/views/CheckoutView';
import { pageMetadata } from '@/lib/routes';

// The checkout works on the cart in each visitor's browser: nothing here for search engines.
export const metadata = {
  ...pageMetadata('checkout', 'en'),
  robots: { index: false, follow: false },
};

export default function Page() {
  return <CheckoutView locale="en" />;
}
