/**
 * What the account area shows, in place of the sign-in form, while the browser holds a session
 * hint and the API has not yet confirmed it (FC 053 T1.1, T2.1): the shape of the signed-in area
 * in grey (the breadcrumb, the greeting and a table), never a screen made for a visitor.
 *
 * It is always in the prerendered page and stays out of sight (`display: none`) until the document
 * is marked `<html data-session>`, which the head script does before the first paint; the area
 * removes it by leaving the sign-in stage, and the mark goes when the hint does.
 *
 * @param text - What assistive technology hears while it waits (`account.sessionLoading`).
 */
export function SessionSkeleton({ text }: Readonly<{ text: string }>) {
  const bar = 'rounded bg-petroleo/10 motion-safe:animate-pulse';
  return (
    <output
      data-session-skeleton=""
      aria-busy="true"
      className="flex-col gap-6"
    >
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="flex flex-col gap-3">
        <span className={`${bar} h-5 w-48`} />
        <span className={`${bar} h-7 w-64`} />
      </span>
      <span aria-hidden="true" className={`${bar} h-48 w-full max-w-3xl`} />
    </output>
  );
}
