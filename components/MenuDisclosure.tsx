'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** Props of {@link MenuDisclosure}. */
interface MenuDisclosureProps {
  /** Classes of the `<details>` element. */
  className: string;
  /** The `<summary>` and the menu panel. */
  children: ReactNode;
}

/**
 * Native `<details>` menu that closes itself when one of its links is followed (FC 043 T2.3).
 *
 * The header lives in the layout, so with client navigation (`next/link`) it is not rebuilt on a
 * page change: without this, the menu would stay open over the new page. The listener is
 * delegated to the `<details>` and reacts only to clicks that come from a link, which the
 * keyboard also fires (Enter on a link), so no non-interactive element gets its own handler.
 * Without JavaScript the click is a full page load, which resets the menu anyway.
 */
export function MenuDisclosure({
  className,
  children,
}: Readonly<MenuDisclosureProps>) {
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    // Effects run after the commit, so the ref already holds the element.
    const element = menu.current as HTMLDetailsElement;
    const closeOnLink = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('a')) {
        element.open = false;
      }
    };
    element.addEventListener('click', closeOnLink);
    return () => element.removeEventListener('click', closeOnLink);
  }, []);

  return (
    <details ref={menu} className={className}>
      {children}
    </details>
  );
}
