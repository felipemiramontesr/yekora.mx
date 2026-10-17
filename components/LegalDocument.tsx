import type { ReactNode } from 'react';
import type { Messages } from '@/app/i18n';

/** Keys of `legal` that hold a full document (title + sections). */
type LegalDocumentKey = 'privacy' | 'cookies' | 'terms' | 'shipping';

/** Props of {@link LegalDocument}. */
interface LegalDocumentProps {
  /** The localized `legal` dictionary; supplies the "last updated" label and date. */
  legal: Messages['legal'];
  /** The document to render: privacy notice, cookie policy, terms or shipping and returns. */
  document: Messages['legal'][LegalDocumentKey];
  /** Extra content after the sections, e.g. the cookie table. */
  children?: ReactNode;
}

/**
 * Shared layout of every legal page: title, last-updated date and the document's sections.
 *
 * Invariant (FC 005, I-AntiPending): the published texts are final. There is no draft notice
 * and no placeholder; anything still pending lives in the local backlog (K), never on the site.
 */
export function LegalDocument({
  legal,
  document,
  children,
}: Readonly<LegalDocumentProps>) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-4xl font-semibold">{document.title}</h1>
      <p className="mt-3 text-sm text-petroleo/80">
        {legal.updatedLabel}: {legal.updated}
      </p>
      {document.sections.map((section) => (
        <section key={section.title} className="mt-10">
          <h2 className="text-2xl font-semibold">{section.title}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="mt-3 leading-relaxed">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
      {children}
    </article>
  );
}
