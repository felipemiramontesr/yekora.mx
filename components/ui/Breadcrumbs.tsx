import Link from 'next/link';
import type { MouseEvent, ReactNode } from 'react';
import { breadcrumbsVerdict, type Crumb } from '@/lib/ui/breadcrumbsGate';

const LINK = 'tap-target underline underline-offset-4';

/** A step that leads somewhere: through the router of the site, or through the area's own. */
function StepLink({ step }: Readonly<{ step: Crumb & { href: string } }>) {
  const { href, label, onSelect } = step;
  if (onSelect === undefined) {
    return (
      <Link href={href} className={LINK}>
        {label}
      </Link>
    );
  }
  return (
    <a
      href={href}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        onSelect();
      }}
      className={LINK}
    >
      {label}
    </a>
  );
}

/** One step as an item of the list; the page one is on is the item marked as current. */
function Step({
  step,
  children,
}: Readonly<{ step: Crumb; children: ReactNode }>) {
  const { href, label } = step;
  return href === undefined ? (
    <li
      aria-current="page"
      className="flex items-center gap-2 font-semibold text-petroleo"
    >
      {children}
      {label}
    </li>
  ) : (
    <li className="flex items-center gap-2">
      {children}
      <StepLink step={{ ...step, href }} />
    </li>
  );
}

/**
 * «Where you are» (FC 078, K-82): a named navigation with the steps in order, each one a link but
 * the page one is on, which is marked as current. A trail the gate refuses is not drawn at all,
 * rather than drawn half. The public pages and the account area share it.
 *
 * @param label - The accessible name of the navigation.
 * @param steps - The trail, from the root to the page.
 */
export function Breadcrumbs({
  label,
  steps,
}: Readonly<{ label: string; steps: readonly Crumb[] }>) {
  if (breadcrumbsVerdict(label, steps) !== 'BREADCRUMBS_RESOLVED') return null;
  return (
    <nav aria-label={label}>
      <ol className="flex flex-wrap items-center gap-2 text-sm text-petroleo/80">
        {steps.map((step, index) => (
          <Step key={step.label} step={step}>
            {index > 0 && <span aria-hidden="true">›</span>}
          </Step>
        ))}
      </ol>
    </nav>
  );
}
