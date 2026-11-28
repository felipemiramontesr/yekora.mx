'use client';

import type { ReactNode } from 'react';

/**
 * The English half of a bilingual field of the catalog (FC 078 T2.7): folded away while it is
 * empty, open when it already holds text. A required field folded away would stop the browser from
 * sending the form without saying why, so the disclosure opens itself when its field is refused.
 *
 * @param label - What the summary says, with whether English is required.
 * @param filled - Whether the field already holds text.
 * @param children - The field.
 */
export function EnglishDisclosure({
  label,
  filled,
  children,
}: Readonly<{ label: string; filled: boolean; children: ReactNode }>) {
  return (
    <details
      open={filled}
      onInvalidCapture={(event) => {
        event.currentTarget.open = true;
      }}
      className="min-w-0"
    >
      <summary className="tap-target cursor-pointer underline underline-offset-4">
        {label}
      </summary>
      <div className="pt-2">{children}</div>
    </details>
  );
}
