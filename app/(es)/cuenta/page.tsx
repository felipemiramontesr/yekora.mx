import { AccountView } from '@/components/views/AccountView';
import { pageMetadata } from '@/lib/routes';

// Private and client-rendered behind a session: nothing here for search engines.
export const metadata = {
  ...pageMetadata('account', 'es-MX'),
  robots: { index: false, follow: false },
};

export default function Page() {
  return <AccountView locale="es-MX" />;
}
