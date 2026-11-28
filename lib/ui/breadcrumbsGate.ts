/**
 * The steps of a trail of breadcrumbs and the gate that decides whether it is drawn (FC 078 T1.2).
 *
 * @module
 */

/** One step of a trail: its name and, for every step but the page one is on, where it leads. */
export interface Crumb {
  /** The step's name, in the page's language. */
  label: string;
  /** Where it leads; the last step has none. */
  href?: string;
  /**
   * Takes the person there without loading a page, for an area that routes its own paths: the
   * address stays in `href`, for the new tab and the screen reader.
   */
  onSelect?: () => void;
}

/** Why a trail is not drawn (T1.2). */
type BreadcrumbsVerdict =
  | 'BREADCRUMBS_RESOLVED'
  | 'BREADCRUMB_STEPS_EMPTY_REJECT'
  | 'PARENT_HREF_MISSING_REJECT'
  | 'CURRENT_LEAF_INVALID_REJECT'
  | 'A11Y_MARKUP_DEFECTIVE_REJECT';

/**
 * The gate of a trail (FC 078 T1.2), judged in order: there are steps; every step before the last
 * leads somewhere; the last one, the page itself, does not; and the trail and each step have a
 * name to be read.
 *
 * @param label - The accessible name of the navigation.
 * @param steps - The trail, from the root to the page.
 * @returns BREADCRUMBS_RESOLVED, or why the trail is not drawn.
 */
export function breadcrumbsVerdict(
  label: string,
  steps: readonly Crumb[]
): BreadcrumbsVerdict {
  const leaf = steps.at(-1);
  if (leaf === undefined) return 'BREADCRUMB_STEPS_EMPTY_REJECT';
  if (steps.slice(0, -1).some((step) => !step.href)) {
    return 'PARENT_HREF_MISSING_REJECT';
  }
  if (leaf.href !== undefined) return 'CURRENT_LEAF_INVALID_REJECT';
  const named = [label, ...steps.map((step) => step.label)];
  return named.every((text) => text.trim() !== '')
    ? 'BREADCRUMBS_RESOLVED'
    : 'A11Y_MARKUP_DEFECTIVE_REJECT';
}
