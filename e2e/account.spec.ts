import { expect, test } from '@playwright/test';
import {
  E2E_CODE,
  E2E_ORDER,
  mockAccountApi,
  openAccountSidebar,
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
  await expect(page.getByRole('link', { name: 'Panel: pedidos' })).toHaveCount(
    0
  );
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
  await openAccountSidebar(page);
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
  await openAccountSidebar(page);
  await page.getByRole('button', { name: 'Salir' }).click();
  await signIn();
  await expect(page.getByText('Hola, Ana E2E')).toBeVisible();
  await openAccountSidebar(page);
  await page.getByRole('button', { name: 'Olvidar este dispositivo' }).click();
  await expect(page.getByText('te pediremos el código')).toBeVisible();
  await openAccountSidebar(page);
  await page.getByRole('button', { name: 'Salir' }).click();
  await signIn();
  await expect(
    page.getByRole('heading', { name: 'Revisa tu correo' })
  ).toBeVisible();
});

test('staff see the panel’s orders, in English too', async ({ page }) => {
  await mockAccountApi(page, { signedIn: 'staff' });
  await page.goto('/en/account/');
  await expect(page.getByText('Hello, Luis E2E')).toBeVisible();
  await openAccountSidebar(page);
  await page.getByRole('link', { name: 'Panel: orders' }).click();
  await expect(page).toHaveURL(/\/en\/account\/panel\/$/);
  await expect(page.getByLabel('Status')).toBeVisible();
  await page
    .getByRole('link', { name: `See the details of order ${E2E_ORDER}` })
    .click();
  await expect(page).toHaveURL(new RegExp(`/en/account/panel/${E2E_ORDER}/$`));
  await expect(page.getByText('Payment events')).toBeVisible();
});

test('the header leads to the account area in each language', async ({
  page,
}) => {
  await mockAccountApi(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Mi cuenta' }).click();
  await expect(page).toHaveURL(/\/cuenta\/$/);
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
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
  await expect(header.getByText('Ana', { exact: true })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), HINT)).toBe(
    'Ana'
  );
  await header.getByLabel('Mi cuenta: Ana').click();
  await header.getByRole('button', { name: 'Salir' }).click();
  // The area of the account reacts to the same change: no session is left to show.
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await expect(header.getByRole('link', { name: 'Mi cuenta' })).toBeVisible();
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
  await expect(header.getByLabel('Mi cuenta: Ana')).toBeVisible();
  await expect(header.getByText('Ana', { exact: true })).toBeHidden();
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
    await expect(
      page
        .getByRole('banner')
        .getByRole('link', { name: /Mi cuenta|My account/ })
    ).toBeVisible();
  }
  expect(asked).toEqual([]);
});

/**
 * FC 046 F0 · The sidebar of the account area (T1.2, T2.3): folded to icons on a wide screen and
 * remembered when opened; a drawer on a phone that closes with Escape; sections by role; no e-mail.
 */
test('on a wide screen the sidebar starts folded, opens, is remembered and shows only the name (FC 046 T2.3)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'staff' });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/cuenta/');
  const sidebar = page.getByRole('complementary', {
    name: 'Barra lateral de tu cuenta',
  });
  await expect(sidebar).toBeVisible();
  expect((await sidebar.boundingBox())?.width).toBeLessThan(100);
  await expect(
    sidebar.getByRole('link', { name: 'Mis pedidos' })
  ).toHaveAttribute('title', 'Mis pedidos');
  await page
    .getByRole('button', { name: 'Desplegar la barra lateral' })
    .click();
  expect((await sidebar.boundingBox())?.width).toBeGreaterThan(200);
  await expect(sidebar.getByText('Luis E2E')).toBeVisible();
  await expect(sidebar.getByText('luis@example.test')).toHaveCount(0);
  await expect(
    sidebar.getByRole('link', { name: 'Mis pedidos' })
  ).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Replegar la barra lateral' })
  ).toHaveAttribute('aria-expanded', 'true');
});

test('on a phone the sidebar is a drawer that closes with Escape and returns the focus (FC 046 T2.3)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'buyer' });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/cuenta/');
  const sidebar = page.getByRole('complementary', {
    name: 'Barra lateral de tu cuenta',
  });
  await expect(sidebar).toBeHidden();
  const opener = page.getByRole('button', { name: 'Menú de la cuenta' });
  await opener.click();
  await expect(sidebar).toBeVisible();
  expect((await sidebar.boundingBox())?.width).toBe(250);
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeHidden();
  await expect(opener).toBeFocused();
});
