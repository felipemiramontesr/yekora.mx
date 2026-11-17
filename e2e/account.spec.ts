import { expect, test } from '@playwright/test';
import {
  E2E_CODE,
  E2E_ORDER,
  mockAccountApi,
  openAccountMenu,
} from './support/accountApi';

/**
 * FC 028 F2 · The account area in a real browser, against the emulated account API
 * (e2e/support/accountApi.ts): signing in with the mailed code, the buyer's orders, the panel for
 * staff, and the sub-paths the area writes as it navigates. The Apache fallback of those
 * sub-paths on a fresh load is checked in htaccess.spec.ts (CI httpd only).
 */

test('a buyer signs in with the mailed code and opens an order', async ({
  page,
}) => {
  await mockAccountApi(page);
  await page.goto('/cuenta/');
  await page.getByLabel('Correo electrónico').fill('ana@example.test');
  await page
    .getByLabel('Contraseña', { exact: true })
    .fill('correct horse battery');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(
    page.getByRole('heading', { name: 'Revisa tu correo' })
  ).toBeVisible();
  await page.getByLabel('Código').fill('000000');
  await page.getByRole('button', { name: 'Confirmar' }).click();
  // Next.js keeps its own route announcer (also an alert) outside main.
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'no es correcto'
  );
  await page.getByLabel('Código').fill(E2E_CODE);
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Hola, Ana E2E')).toBeVisible();
  // A buyer is offered no console: not in the menu, and no «Administración» either (FC 052 T1.1).
  await openAccountMenu(page);
  await expect(
    page.getByRole('banner').getByRole('link', { name: 'Administración' })
  ).toHaveCount(0);
  await expect(
    page.getByRole('banner').getByRole('link', { name: 'Panel: pedidos' })
  ).toHaveCount(0);
  // Fold the menu again: it is a <details>, and an open one would cover the table.
  await page.getByRole('banner').locator('summary').click();
  await page
    .getByRole('link', { name: `Ver detalle del pedido ${E2E_ORDER}` })
    .click();
  await expect(page).toHaveURL(new RegExp(`/cuenta/${E2E_ORDER}/$`));
  await expect(
    page.getByRole('heading', { name: `Pedido ${E2E_ORDER}` })
  ).toBeVisible();
  await expect(page.getByText('E2E-0001')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/cuenta\/$/);
  await expect(page.getByRole('table')).toBeVisible();
  await openAccountMenu(page);
  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
});

test('a buyer remembers this device, signs in again without a code, then forgets it (Enmienda 1, E2)', async ({
  page,
}) => {
  await mockAccountApi(page);
  await page.goto('/cuenta/');
  const signIn = async () => {
    await page.getByLabel('Correo electrónico').fill('ana@example.test');
    await page
      .getByLabel('Contraseña', { exact: true })
      .fill('correct horse battery');
    await page.getByRole('button', { name: 'Continuar' }).click();
  };
  await signIn();
  await page.getByLabel('Recordar este dispositivo 30 días').check();
  await page.getByLabel('Código').fill(E2E_CODE);
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Hola, Ana E2E')).toBeVisible();
  await openAccountMenu(page);
  await page.getByRole('button', { name: 'Salir' }).click();
  await signIn();
  await expect(page.getByText('Hola, Ana E2E')).toBeVisible();
  await openAccountMenu(page);
  await page.getByRole('button', { name: 'Olvidar este dispositivo' }).click();
  await expect(page.getByText('te pediremos el código')).toBeVisible();
  await openAccountMenu(page);
  await page.getByRole('button', { name: 'Salir' }).click();
  await signIn();
  await expect(
    page.getByRole('heading', { name: 'Revisa tu correo' })
  ).toBeVisible();
});

test('a buyer keeps their data and up to five addresses, and the header follows the default one (FC 051 T1.4, T2.6)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'buyer' });
  await page.goto('/cuenta/');
  await expect(page.getByText('Hola, Ana E2E')).toBeVisible();
  const delivery = page.getByRole('banner').getByRole('link', {
    name: /Agregar CP|Enviar al código postal/,
  });
  await expect(delivery).toHaveText(/Agregar CP/);
  await openAccountMenu(page);
  await page.getByRole('link', { name: 'Mi información' }).click();
  await expect(page).toHaveURL(/\/cuenta\/datos\/$/);
  // The e-mail is shown, never a field to change.
  await expect(page.getByText('ana@example.test')).toBeVisible();
  await expect(page.getByLabel('Correo electrónico')).toHaveCount(0);

  const profile = page.getByRole('form', { name: 'Tus datos' });
  await profile.getByLabel('Teléfono').fill('4929421780');
  await profile.getByRole('button', { name: 'Guardar datos' }).click();
  await expect(page.getByText('Datos guardados.')).toBeVisible();

  const addAddress = async (label: string, street: string, postal: string) => {
    await page.getByRole('button', { name: 'Agregar domicilio' }).click();
    const form = page.getByRole('form', { name: 'Nuevo domicilio' });
    await form.getByLabel('Nombre del domicilio').fill(label);
    await form.getByLabel('Calle').fill(street);
    await form.getByLabel('Número exterior').fill('12');
    await form.getByLabel('Colonia').fill('Centro');
    await form.getByLabel('Municipio o alcaldía').fill('Municipio');
    await form.getByLabel('Código postal').fill(postal);
    await form.getByRole('button', { name: 'Guardar domicilio' }).click();
    await expect(page.getByText('Domicilio guardado.')).toBeVisible();
  };
  await addAddress('Casa', 'Av. Barones', '98612');
  await expect(delivery).toHaveAccessibleName('Enviar al código postal 98612');
  await expect(page.getByText('Predeterminado', { exact: true })).toHaveCount(
    1
  );

  await addAddress('Oficina', 'Calle Reforma', '06600');
  await expect(page.getByText('2 de 5 domicilios')).toBeVisible();
  await page
    .getByRole('button', { name: 'Hacer predeterminado: Oficina' })
    .click();
  await expect(
    page.getByText('Ahora es tu domicilio predeterminado.')
  ).toBeVisible();
  await expect(delivery).toHaveAccessibleName('Enviar al código postal 06600');
  // The browser keeps the state of the default address and nothing else of it.
  const stored = await page.evaluate(() => ({
    state: localStorage.getItem('yekora_shipping_state_v1'),
    all: Object.values({ ...localStorage }).join(' '),
  }));
  expect(stored.state).toBe('CMX');
  expect(stored.all).not.toMatch(/98612|06600|Barones|Reforma|4929421780/);

  await page.getByRole('button', { name: 'Eliminar: Oficina' }).click();
  await expect(page.getByText('¿Eliminar este domicilio?')).toBeVisible();
  await page.getByRole('button', { name: 'Conservar' }).click();
  await expect(page.getByText('2 de 5 domicilios')).toBeVisible();
  await page.getByRole('button', { name: 'Eliminar: Oficina' }).click();
  await page.getByRole('button', { name: 'Sí, eliminar' }).click();
  await expect(page.getByText('Domicilio eliminado.')).toBeVisible();
  await expect(page.getByText('1 de 5 domicilios')).toBeVisible();
  await expect(delivery).toHaveAccessibleName('Enviar al código postal 98612');
});

/**
 * FC 053 · What the person sees, frame by frame. A page samples the screen on every animation frame
 * from the first one of each document and keeps a note of any frame in which a screen made for a
 * visitor is visible: the sign-in form of the area, «Entrar» in the header, the invitation «Tu CP».
 */
const WATCH_VISITOR_SCREENS = () => {
  const visible = (element: Element | null) => {
    if (!element) return false;
    // The content of a closed <details> has boxes but is not on screen.
    const closed = element.closest('details:not([open])');
    if (closed && !closed.querySelector('summary')?.contains(element)) {
      return false;
    }
    const style = getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      element.getClientRects().length > 0
    );
  };
  const words = /^(Entrar|Sign in)$/;
  const seen: string[] = JSON.parse(sessionStorage.getItem('__seen') ?? '[]');
  let frames = Number(sessionStorage.getItem('__frames') ?? '0');
  const sample = () => {
    frames += 1;
    sessionStorage.setItem('__frames', String(frames));
    const offenders: string[] = [];
    for (const heading of document.querySelectorAll('main h2')) {
      if (words.test(heading.textContent?.trim() ?? '') && visible(heading)) {
        offenders.push('sign-in form');
      }
    }
    for (const word of document.querySelectorAll('header summary span')) {
      if (words.test(word.textContent?.trim() ?? '') && visible(word)) {
        offenders.push('header «Entrar»');
      }
    }
    for (const link of document.querySelectorAll(
      'header a[href*="register"]'
    )) {
      if (visible(link)) offenders.push('header «Tu CP»');
    }
    if (offenders.length > 0) {
      seen.push(...offenders);
      sessionStorage.setItem('__seen', JSON.stringify(seen));
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
};

test('with a session, switching language never shows the sign-in form nor the visitor header, in any frame (FC 053 T1.1, T2.1)', async ({
  page,
}) => {
  // A slow API, as Hostinger's sleeping one: the worst case for the flash.
  await mockAccountApi(page, { signedIn: 'buyer', latencyMs: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('yekora_session_first_name_v1', 'Ana');
  });
  await page.addInitScript(WATCH_VISITOR_SCREENS);
  await page.goto('/cuenta/');
  await expect(page.getByText('Hola, Ana E2E')).toBeVisible();
  for (const [from, to, greeting] of [
    ['EN, English', /\/en\/account\/$/, 'Hello, Ana E2E'],
    ['ES, Español', /\/cuenta\/$/, 'Hola, Ana E2E'],
  ] as const) {
    await page.evaluate(() => {
      sessionStorage.setItem('__seen', '[]');
      sessionStorage.setItem('__frames', '0');
    });
    await openAccountMenu(page);
    await page
      .getByRole('banner')
      .getByRole('navigation', { name: /Idioma|Language/ })
      .getByRole('link', { name: from })
      .click();
    await expect(page).toHaveURL(to);
    await expect(page.getByText(greeting)).toBeVisible();
    const watched = await page.evaluate(() => ({
      seen: JSON.parse(sessionStorage.getItem('__seen') ?? '[]') as string[],
      frames: Number(sessionStorage.getItem('__frames')),
    }));
    // The whole wait was watched, and no frame of it showed a visitor's screen.
    expect(watched.frames).toBeGreaterThan(20);
    expect(watched.seen).toEqual([]);
  }
});

test('a visitor still sees the sign-in form and «Entrar» at once, and a stale hint gives way to the form once the API says there is no session (FC 053 T2.1, T2.4)', async ({
  page,
}) => {
  await mockAccountApi(page);
  await page.goto('/cuenta/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-session', '');
  // A hint with no session behind it: grey skeleton first, then the form, and the mark is gone.
  await page.unrouteAll({ behavior: 'wait' });
  await mockAccountApi(page, { latencyMs: 600 });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('stale-done')) {
      localStorage.setItem('yekora_session_first_name_v1', 'Ana');
      sessionStorage.setItem('stale-done', '1');
    }
  });
  await page.goto('/cuenta/');
  await expect(page.locator('html')).toHaveAttribute('data-session', '');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-session', '');
  expect(
    await page.evaluate(() =>
      localStorage.getItem('yekora_session_first_name_v1')
    )
  ).toBeNull();
});

test('the language switch is only in the account menu, and each code is a target of 44 × 44 px (FC 052 T2.2, T2.3)', async ({
  page,
}) => {
  await page.goto('/nosotros/');
  // Not in the footer, for anyone.
  await expect(
    page.getByRole('contentinfo').getByRole('navigation', { name: 'Idioma' })
  ).toHaveCount(0);
  await openAccountMenu(page);
  const switcher = page
    .getByRole('banner')
    .getByRole('navigation', { name: 'Idioma' });
  // Each code, as drawn, is at least 44 × 44 px: what can be pressed is what is seen.
  for (const name of ['ES, Español', 'EN, English']) {
    const box = await switcher.getByRole('link', { name }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  await switcher.getByRole('link', { name: 'EN, English' }).click();
  await expect(page).toHaveURL(/\/en\/about\/$/);
});

test('the search box takes 90 % of its cell on a desktop bar and the whole row on a phone (FC 052 T2.5)', async ({
  page,
}) => {
  const share = async () =>
    page.evaluate(() => {
      const form = document.querySelector('header form[role="search"]');
      const cell = form?.closest('div.md\\:mx-auto')?.parentElement;
      const inner = form?.getBoundingClientRect().width ?? 0;
      return inner / (cell?.getBoundingClientRect().width ?? 1);
    });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  expect(await share()).toBeGreaterThan(0.88);
  expect(await share()).toBeLessThan(0.92);
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await share()).toBeGreaterThan(0.98);
});

test('staff see the panel’s orders, in English too', async ({ page }) => {
  await mockAccountApi(page, { signedIn: 'staff' });
  await page.goto('/en/account/');
  await expect(page.getByText('Hello, Luis E2E')).toBeVisible();
  await openAccountMenu(page);
  await page.getByRole('link', { name: 'Administration' }).click();
  await expect(page).toHaveURL(/\/en\/account\/administracion\/$/);
  await page.getByRole('link', { name: /^Orders/ }).click();
  await expect(page).toHaveURL(/\/en\/account\/panel\/$/);
  await expect(page.getByLabel('Status')).toBeVisible();
  await page
    .getByRole('link', { name: `See the details of order ${E2E_ORDER}` })
    .click();
  await expect(page).toHaveURL(new RegExp(`/en/account/panel/${E2E_ORDER}/$`));
  await expect(page.getByText('Payment events')).toBeVisible();
});

test('the header menu leads a visitor to sign in or to create an account (FC 047)', async ({
  page,
}) => {
  await mockAccountApi(page);
  await page.goto('/');
  const header = page.getByRole('banner');
  await header.locator('summary').click();
  await header.getByRole('link', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/cuenta\/$/);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.goto('/');
  await header.locator('summary').click();
  await header.getByRole('link', { name: 'Crear cuenta' }).click();
  await expect(
    page.getByRole('heading', { name: 'Crear cuenta' })
  ).toBeVisible();
  // The request leaves the address bar at once.
  await expect(page).toHaveURL(/\/cuenta\/$/);
});

/**
 * FC 046 F0 · The header knows who is signed in (T1.1, T2.2): its first name, kept as a local hint,
 * shown from xl up with a menu, only the icon below, and never asked of the API without a hint.
 */
const HINT = 'yekora_session_first_name_v1';

test('signing in makes the header greet by first name, and signing out from its menu ends the session (FC 046)', async ({
  page,
}) => {
  await mockAccountApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/cuenta/');
  await page.getByLabel('Correo electrónico').fill('ana@example.test');
  await page
    .getByLabel('Contraseña', { exact: true })
    .fill('correct horse battery');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Código').fill(E2E_CODE);
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Hola, Ana E2E')).toBeVisible();
  const header = page.getByRole('banner');
  // Only the first name: not the surname, not the e-mail.
  await expect(header.getByText('Hola, Ana', { exact: true })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), HINT)).toBe(
    'Ana'
  );
  await header.locator('summary').click();
  await header.getByRole('button', { name: 'Salir' }).click();
  // The area of the account reacts to the same change: no session is left to show.
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await expect(header.locator('summary')).toContainText('Entrar');
  expect(
    await page.evaluate((key) => localStorage.getItem(key), HINT)
  ).toBeNull();
});

test('below xl the header shows only the icon, named by its label (FC 046 T2.2)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'buyer' });
  await page.addInitScript((key) => localStorage.setItem(key, 'Ana'), HINT);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  const header = page.getByRole('banner');
  // Only the icon shows, and the words that name it are still read.
  const trigger = header.locator('summary');
  await expect(trigger).toHaveAccessibleName(/Hola, Ana\s*Mi cuenta/);
  expect((await trigger.boundingBox())?.width).toBeLessThan(60);
});

test('a visitor without the hint never asks the API who is signed in (FC 046 T2.2)', async ({
  page,
}) => {
  await mockAccountApi(page);
  const asked: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/v1/account/me')) asked.push(request.url());
  });
  for (const path of ['/', '/catalogo/', '/en/']) {
    await page.goto(path);
    await expect(page.getByRole('banner').locator('summary')).toContainText(
      /Entrar|Sign in/
    );
  }
  expect(asked).toEqual([]);
});

/**
 * FC 047 T2.5 · The area has no navigation of its own: the sections, sign-out and the language are
 * in the account menu of the header, and the area only says where you are.
 */
test('the area shows only a breadcrumb: the sections are in the header menu (FC 047 T2.5)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'staff' });
  await page.goto('/cuenta/');
  const crumbs = page.getByRole('navigation', {
    name: 'Dónde estás en tu cuenta',
  });
  await expect(crumbs).toContainText('Mi cuenta');
  await expect(crumbs.getByText('Mis pedidos')).toHaveAttribute(
    'aria-current',
    'page'
  );
  await expect(page.getByRole('complementary')).toHaveCount(0);
  await expect(
    page.getByRole('main').getByRole('button', { name: 'Salir' })
  ).toHaveCount(0);
  await openAccountMenu(page);
  const header = page.getByRole('banner');
  await expect(header.getByText('Luis E2E', { exact: true })).toBeVisible();
  await expect(header.getByText('luis@example.test')).toHaveCount(0);
  // The consoles are cards of «Administración», one click from the menu (FC 052 T1.1).
  await header.getByRole('link', { name: 'Administración' }).click();
  await expect(page).toHaveURL(/\/cuenta\/administracion\/$/);
  await page
    .getByRole('main')
    .getByRole('link', { name: /^Pedidos/ })
    .click();
  await expect(page).toHaveURL(/\/cuenta\/panel\/$/);
  // Mi cuenta › Administración › Pedidos, with «Administración» leading back to the cards.
  await expect(crumbs.getByText('Pedidos')).toHaveAttribute(
    'aria-current',
    'page'
  );
  await crumbs.getByRole('link', { name: 'Administración' }).click();
  await expect(page).toHaveURL(/\/cuenta\/administracion\/$/);
  // The same area, no reload: the menu follows the page it is on.
  await openAccountMenu(page);
  await expect(
    header.getByRole('link', { name: 'Administración' })
  ).toHaveAttribute('aria-current', 'page');
});

test('pointing at the other language warms its page up, and the header opens the API connection early (FC 053 T1.2)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'buyer' });
  await page.addInitScript(() => {
    localStorage.setItem('yekora_session_first_name_v1', 'Ana');
  });
  await page.goto('/cuenta/');
  await expect(page.getByText('Hola, Ana E2E')).toBeVisible();
  await expect(
    page.locator('head link[rel="preconnect"][href="https://apiv1.yekora.mx"]')
  ).toHaveCount(1);
  await expect(page.locator('head link[rel="prefetch"]')).toHaveCount(0);
  await openAccountMenu(page);
  await page
    .getByRole('banner')
    .getByRole('navigation', { name: 'Idioma' })
    .getByRole('link', { name: 'EN, English' })
    .hover();
  await expect(
    page.locator('head link[rel="prefetch"][href="/en/account/"]')
  ).toHaveCount(1);
});
