import { expect, test } from '@playwright/test';
import { mockAccountApi, openAccountMenu } from './support/accountApi';

/**
 * FC 061 F1 · The shipping console in a real browser, against the emulated account API
 * (e2e/support/accountApi.ts): the owner reaches `{area}envios/` from «Administración», edits the
 * rate of a state and free shipping, and an account without `shipping:manage` is never offered it.
 */

test('the owner edits the rate of a state and free shipping from Administración (FC 061 T1.1, T1.2)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'owner' });
  await page.goto('/cuenta/');
  await openAccountMenu(page);
  await page
    .getByRole('banner')
    .getByRole('link', { name: 'Administración' })
    .click();
  await page
    .getByRole('main')
    .getByRole('link', { name: /^Envíos/ })
    .click();
  await expect(page).toHaveURL(/\/cuenta\/envios\/$/);
  await expect(
    page.getByText('Estrategia activa: Tarifa por estado.')
  ).toBeVisible();

  const zacatecas = page.getByLabel('Tarifa de envío a Zacatecas');
  await expect(zacatecas).toHaveValue('150.00');
  await zacatecas.fill('99.50');
  await page.getByRole('button', { name: 'Guardar tarifas' }).click();
  await expect(page.getByText('Cambios guardados.')).toBeVisible();
  await expect(zacatecas).toHaveValue('99.50');
  await expect(page.getByLabel('Tarifa de envío a Aguascalientes')).toHaveValue(
    '150.00'
  );

  await page
    .getByLabel('Ofrecer envío gratis desde un monto de compra')
    .check();
  await page.getByLabel('Monto mínimo de compra (MXN)').fill('1500');
  await page.getByRole('button', { name: 'Guardar envío gratis' }).click();
  await expect(page.getByText('Cambios guardados.')).toBeVisible();
  await expect(page.getByLabel('Monto mínimo de compra (MXN)')).toHaveValue(
    '1500.00'
  );

  // A rate that is not an amount is refused in the browser, before the API.
  await zacatecas.fill('abc');
  await page.getByRole('button', { name: 'Guardar tarifas' }).click();
  await expect(
    page.getByText(
      'Revisa los importes: usa números de 0 a 100,000 con hasta dos decimales.'
    )
  ).toBeVisible();
});

test('the console has the same address in English, and an account without the permission is never offered it (FC 061 T2.4; typing the address by hand is covered in account.test.tsx)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'owner' });
  await page.goto('/en/account/');
  await openAccountMenu(page);
  await page
    .getByRole('banner')
    .getByRole('link', { name: 'Administration' })
    .click();
  await page
    .getByRole('main')
    .getByRole('link', { name: /^Shipping/ })
    .click();
  await expect(page).toHaveURL(/\/en\/account\/envios\/$/);
  await expect(page.getByLabel('Shipping rate to Mexico City')).toHaveValue(
    '150.00'
  );
  await page.unrouteAll({ behavior: 'wait' });
  await mockAccountApi(page, { signedIn: 'staff' });
  await page.goto('/en/account/');
  await expect(page.getByText('Hello, Luis E2E')).toBeVisible();
  await openAccountMenu(page);
  await page.getByRole('link', { name: 'Administration' }).click();
  await expect(
    page.getByRole('main').getByRole('link', { name: /^Shipping/ })
  ).toHaveCount(0);
});
