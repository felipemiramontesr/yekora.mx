import { getMessages, type Locale } from '@/app/i18n';
import { routeFor } from '@/lib/routes';
import type { Crumb } from '@/lib/ui/breadcrumbsGate';
import { Breadcrumbs } from './ui/Breadcrumbs';

/**
 * The trail of a public page (FC 078, K-82): «Inicio», the steps in between and the page, in the
 * page's language.
 *
 * @param locale - Language of the page.
 * @param steps - What follows «Inicio»; the last one is the page and has no address.
 */
export function PageTrail({
  locale,
  steps,
}: Readonly<{ locale: Locale; steps: readonly Crumb[] }>) {
  const { breadcrumbs } = getMessages(locale);
  return (
    <Breadcrumbs
      label={breadcrumbs.label}
      steps={[
        { label: breadcrumbs.home, href: routeFor('home', locale) },
        ...steps,
      ]}
    />
  );
}
