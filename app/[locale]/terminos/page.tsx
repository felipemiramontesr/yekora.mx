import { LegalDocument } from '@/components/LegalDocument';
import { getMessages } from '../../i18n';
import { pageMetadata, resolveLocale, type LocaleParams } from '../locale';

export const generateMetadata = pageMetadata('terms');

export default async function TermsPage({ params }: Readonly<LocaleParams>) {
  const { legal } = getMessages(await resolveLocale(params));
  return <LegalDocument legal={legal} document={legal.terms} />;
}
