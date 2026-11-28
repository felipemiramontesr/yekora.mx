import Link from 'next/link';
import { breadcrumbsVerdict, type Crumb } from '@/lib/ui/breadcrumbsGate';

/**
 * «Where you are» (FC 078, K-82): a named navigation with the steps in order, each one a link but
 * the page one is on, which is marked as current. A trail the gate refuses is not drawn at all,
 * rather than drawn half.
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
          <li key={step.label} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden="true">›</span>}
            {step.href === undefined ? (
              <span aria-current="page" className="font-semibold text-petroleo">
                {step.label}
              </span>
            ) : (
              <Link
                href={step.href}
                className="tap-target underline underline-offset-4"
              >
                {step.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
