import { expect, test } from '@playwright/test';
import { mockAccountApi } from './support/accountApi';

/**
 * FC 076 F4 · The point of sale in a real browser, against the emulated account API
 * (e2e/support/accountApi.ts): the owner opens the till, finds a product, charges it in cash with
 * its change, prints the receipt, and closes with a blind count that needs a note when it differs.
 */
test('the owner opens the till, sells for cash, sees the receipt and closes with a blind count (FC 076)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'owner' });
  await page.goto('/cuenta/');
  await expect(page.getByRole('main').getByText(/^Hola, /)).toBeVisible();
  await page.evaluate(() =>
    globalThis.history.pushState(null, '', '/cuenta/pos/')
  );
  await page.evaluate(() =>
    globalThis.dispatchEvent(new PopStateEvent('popstate'))
  );
  const open = page.getByRole('form', { name: 'Abrir la caja' });
  await open.getByLabel('Fondo inicial (MXN)').fill('500');
  await open.getByRole('button', { name: 'Abrir turno' }).click();
  await expect(page.getByText(/Turno abierto con un fondo/)).toBeVisible();

  const search = page.getByRole('form', { name: 'Buscar producto' });
  await search.getByRole('button', { name: 'Buscar' }).click();
  await page.getByRole('button', { name: 'Agregar: E2E-0001' }).click();
  const charge = page.getByRole('form', { name: 'Cobrar' });
  await charge.getByLabel('Recibido (MXN)').fill('1200');
  await expect(charge.getByText(/Cambio: \$40\.00 MXN/)).toBeVisible();
  await charge.getByRole('button', { name: 'Registrar venta' }).click();
  await expect(
    page.getByText(/Venta YEK-2026-E2E00001 registrada/)
  ).toBeVisible();
  await page.getByRole('button', { name: 'Ver comprobante' }).click();
  await expect(page.getByText('No es comprobante fiscal')).toBeVisible();

  const close = page.getByRole('form', { name: 'Cerrar el turno' });
  await close.getByLabel('Efectivo contado (MXN)').fill('1650');
  await close.getByRole('button', { name: 'Cerrar turno' }).click();
  await expect(
    close.getByText(/nota de al menos 10 letras/).last()
  ).toBeVisible();
  await close
    .getByLabel('Nota de la diferencia (si la hay)')
    .fill('Faltó cambio de una venta');
  await close.getByRole('button', { name: 'Cerrar turno' }).click();
  await expect(page.getByText(/Turno cerrado/)).toBeVisible();
  await expect(page.getByRole('form', { name: 'Abrir la caja' })).toBeVisible();
});
