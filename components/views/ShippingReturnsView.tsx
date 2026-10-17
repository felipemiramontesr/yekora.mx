import { getMessages, type Locale } from '@/app/i18n';
import { LegalDocument } from '../LegalDocument';

/**
 * Shipping and returns policy (FC 005), shared by `/envios-y-devoluciones/` and
 * `/en/shipping-and-returns/`.
 *
 * The rules come from Ω's decisions recorded in K-08: nationwide courier shipping, 30 calendar
 * days to return, return shipping paid by YĒKORA only when the product arrived damaged,
 * defective or wrong (truth table T1.1), refund within 10 business days of receiving the
 * return, and the manufacturer's warranty. Same layout as the other legal pages.
 *
 * @param locale - Language of the page; picks the dictionary.
 */
export function ShippingReturnsView({ locale }: Readonly<{ locale: Locale }>) {
  const { legal } = getMessages(locale);
  return <LegalDocument legal={legal} document={legal.shipping} />;
}
