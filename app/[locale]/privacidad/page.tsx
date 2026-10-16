import { LegalDocument } from '@/components/LegalDocument';
import { getMessages } from '../../i18n';
import { pageMetadata, resolveLocale, type LocaleParams } from '../locale';

export const generateMetadata = pageMetadata('privacy');

export default async function PrivacyPage({ params }: Readonly<LocaleParams>) {
  const { legal } = getMessages(await resolveLocale(params));
  return <LegalDocument legal={legal} document={legal.privacy} />;
}
