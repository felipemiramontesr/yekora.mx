import type { ReactNode } from 'react';
import type { Messages } from '@/app/i18n';

interface LegalDocumentProps {
  legal: Messages['legal'];
  document: Messages['legal']['privacy' | 'cookies' | 'terms'];
  children?: ReactNode;
}

// Shared layout of the privacy notice, cookie policy and terms: same structure, different text.
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
      <p
        role="note"
        className="mt-6 border-l-4 border-ocre bg-white/60 p-4 text-sm"
      >
        {legal.draftNotice}
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
