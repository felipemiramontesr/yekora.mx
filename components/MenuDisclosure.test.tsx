// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MenuDisclosure } from './MenuDisclosure';

afterEach(cleanup);

/** Renders an open menu with a summary, a plain area and a link, and returns its parts. */
function openMenu() {
  const { container } = render(
    <MenuDisclosure className="menu">
      <summary>Menu</summary>
      <nav>
        <p>Header text</p>
        <a href="/en/about/">About</a>
      </nav>
    </MenuDisclosure>
  );
  const menu = container.querySelector('details');
  if (!menu) throw new Error('details missing');
  menu.open = true;
  const link = menu.querySelector('a');
  // jsdom does not navigate; stop the default so the test stays on the page.
  link?.addEventListener('click', (event) => event.preventDefault());
  return { menu, link, text: menu.querySelector('p') };
}

describe('MenuDisclosure (FC 043 T2.3)', () => {
  it('renders a native details element with its classes', () => {
    const { menu } = openMenu();
    expect(menu.className).toBe('menu');
  });

  it('stays open when the click does not come from a link', () => {
    const { menu, text } = openMenu();
    text?.click();
    expect(menu.open).toBe(true);
  });

  it('closes when one of its links is followed', () => {
    const { menu, link } = openMenu();
    link?.click();
    expect(menu.open).toBe(false);
  });

  it('stops listening once unmounted', () => {
    const { menu, link } = openMenu();
    cleanup();
    menu.open = true;
    link?.click();
    expect(menu.open).toBe(true);
  });
});
