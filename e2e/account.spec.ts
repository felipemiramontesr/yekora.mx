import { expect, test } from '@playwright/test';
import { E2E_CODE, E2E_ORDER, mockAccountApi } from './support/accountApi';

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
  await page.getByRole('button', { name: 'Salir' }).click();
  await signIn();
  await expect(page.getByText('Hola, Ana E2E')).toBeVisible();
  await page.getByRole('button', { name: 'Olvidar este dispositivo' }).click();
  await expect(page.getByText('te pediremos el código')).toBeVisible();
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
