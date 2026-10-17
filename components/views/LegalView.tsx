import { getMessages, type Locale } from '@/app/i18n';
import { LegalDocument } from '../LegalDocument';

/** Props of {@link LegalView}. */
interface LegalViewProps {
  /** Language of the page; picks the dictionary. */
  locale: Locale;
  /** Which legal document to render. */
  document: 'privacy' | 'cookies' | 'terms';
}

/**
 * Privacy notice, cookie policy or terms, shared by the Spanish and English routes.
 * The cookie policy also renders the table of cookies the site sets (exactly one, FC 003).
 */
export function LegalView({ locale, document }: Readonly<LegalViewProps>) {
  const { legal } = getMessages(locale);
  if (document !== 'cookies') {
    return <LegalDocument legal={legal} document={legal[document]} />;
  }
  const { table } = legal.cookies;
  return (
    <LegalDocument legal={legal} document={legal.cookies}>
      <table className="mt-10 w-full border-collapse text-left text-sm">
        <caption className="mb-3 text-left font-semibold">
          {table.caption}
        </caption>
        <thead>
          <tr className="border-b-2 border-ocre">
            <th scope="col" className="py-2 pr-4">
              {table.name}
            </th>
            <th scope="col" className="py-2 pr-4">
              {table.purpose}
            </th>
            <th scope="col" className="py-2">
              {table.duration}
            </th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.name} className="border-b border-petroleo/15">
              <td className="py-2 pr-4 font-mono">{row.name}</td>
              <td className="py-2 pr-4">{row.purpose}</td>
              <td className="py-2">{row.duration}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </LegalDocument>
  );
}
