'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { disciplines, getMessages, type Locale } from '@/app/i18n';
import { routeFor } from '@/lib/routes';
import { PageTrail } from '../PageTrail';

/** The trail of the catalog: with the discipline the address asks for as its last step. */
function Trail({
  locale,
  asked,
}: Readonly<{ locale: Locale; asked: string | null }>) {
  const messages = getMessages(locale);
  const { catalog } = messages.breadcrumbs;
  const discipline = disciplines.find((name) => name === asked);
  return (
    <PageTrail
      locale={locale}
      steps={
        discipline === undefined
          ? [{ label: catalog }]
          : [
              { label: catalog, href: routeFor('catalog', locale) },
              { label: messages.disciplines[discipline] },
            ]
      }
    />
  );
}

/** The trail once the address can be read. */
function FromAddress({ locale }: Readonly<{ locale: Locale }>) {
  const params = useSearchParams();
  return <Trail locale={locale} asked={params?.get('disciplina') ?? null} />;
}

/**
 * «Inicio › Catálogo (› Disciplina)» (FC 078 T2.5). The prerendered page carries the trail without
 * a discipline; the browser adds the one of `?disciplina=`.
 *
 * @param locale - Language of the page.
 */
export function CatalogTrail({ locale }: Readonly<{ locale: Locale }>) {
  return (
    <Suspense fallback={<Trail locale={locale} asked={null} />}>
      <FromAddress locale={locale} />
    </Suspense>
  );
}
