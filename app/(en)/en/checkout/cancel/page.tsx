import { CheckoutReturnView } from '@/components/views/CheckoutView';
import { pageMetadata } from '@/lib/routes';

// A return page shows one buyer's order: never indexed (FC 012, A05).
export const metadata = {
  ...pageMetadata('checkoutCancel', 'en'),
  robots: { index: false, follow: false },
};

export default function Page() {
  return <CheckoutReturnView locale="en" variant="cancel" />;
}
