import { LegalView } from '@/components/views/LegalView';
import { pageMetadata } from '@/lib/routes';

export const metadata = pageMetadata('cookies', 'en');

export default function Page() {
  return <LegalView locale="en" document="cookies" />;
}
