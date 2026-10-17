/**
 * YĒKORA's own discipline pictograms (FC 004).
 *
 * Lucide has no climbing or canyoning icon, so the five disciplines get original line drawings
 * built on Lucide's grid: 24 × 24 viewBox, 2 px stroke, round caps and joins, no fill. They sit
 * next to Lucide icons without looking foreign.
 *
 * Security invariant (checked by DisciplineIcon.test.tsx): the markup is static paths only,
 * with no script, no event handler, no `javascript:`/`data:` URL and no external reference.
 *
 * @module
 */
import type { ReactNode } from 'react';
import type { Discipline } from '@/app/i18n';

/** Stroke paths of each pictogram, keyed by the discipline slug used across the site. */
const PICTOGRAMS: Record<Discipline, ReactNode> = {
  // Hiking: a trail boot over a contour line.
  senderismo: (
    <>
      <path d="M6 3h5v6l4 2.5h3.5A2.5 2.5 0 0 1 21 14v3H6Z" />
      <path d="M8.5 6h2.5M8.5 9h2.5" />
      <path d="M3 21c3-1.3 6-1.3 9 0s6 1.3 9 0" />
    </>
  ),
  // Mountaineering: a snow-capped peak with a summit flag.
  montana: (
    <>
      <path d="m2 21 7.5-12 4 6 2.5-3.5L22 21Z" />
      <path d="m7 13 2.5 1.5L12 13" />
      <path d="M9.5 9V3l4 1.5-4 1.5" />
    </>
  ),
  // Climbing: a carabiner with its gate open.
  escalada: (
    <>
      <path d="M14.5 5.2A3.5 3.5 0 0 0 11.5 2H9.5A3.5 3.5 0 0 0 6 5.5v12A3.5 3.5 0 0 0 9.5 21h2.2a3 3 0 0 0 2.9-2.2" />
      <path d="m18 6.5-3.4 12.3" />
      <path d="M14.5 5.2 18 6.5" />
    </>
  ),
  // Canyoning: canyon walls, a rope down the middle and water at the bottom.
  canonismo: (
    <>
      <path d="m3 2 2 5-2 4 2 5-2 3" />
      <path d="m21 2-2 5 2 4-2 5 2 3" />
      <path d="M12 2v10" />
      <circle cx="12" cy="14" r="2" />
      <path d="M7 21c1.7-1 3.3-1 5 0s3.3 1 5 0" />
    </>
  ),
  // Trail running: a trail shoe on its lugged sole.
  'trail-running': (
    <>
      <path d="M3 16.5 4.5 9 9 8l2 3h3.5l6.5 3.5v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M3 16h18" />
      <path d="m7 18.5-.5 2M11 18.5l-.5 2M15 18.5l-.5 2M19 18.5l-.5 2" />
    </>
  ),
};

/** Props of {@link DisciplineIcon}. */
interface DisciplineIconProps {
  /** Which discipline to draw. */
  discipline: Discipline;
  /** Rendered width and height in CSS pixels. Defaults to 32. */
  size?: number;
  /** Extra classes for color and spacing; the stroke follows `currentColor`. */
  className?: string;
}

/**
 * Line pictogram of a discipline.
 *
 * Always decorative: it is rendered next to the discipline's visible name, so it carries
 * `aria-hidden="true"` and is not focusable (FC 004, truth table T1.2: decorative ⇒ hidden).
 */
export function DisciplineIcon({
  discipline,
  size = 32,
  className,
}: Readonly<DisciplineIconProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      data-discipline={discipline}
    >
      {PICTOGRAMS[discipline]}
    </svg>
  );
}
