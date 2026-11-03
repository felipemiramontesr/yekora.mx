import { AccountView } from '@/components/views/AccountView';
import { pageMetadata } from '@/lib/routes';

// Private and client-rendered behind a session: nothing here for search engines.
export const metadata = {
  ...pageMetadata('account', 'en'),
  robots: { index: false, follow: false },
};

export default function Page() {
  return <AccountView locale="en" />;
}
