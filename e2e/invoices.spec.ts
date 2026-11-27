import { expect, type Page, test } from '@playwright/test';
import { E2E_ORDER, mockAccountApi } from './support/accountApi';

/**
 * FC 077 F4 · Invoicing in a real browser, against the emulated account API
 * (e2e/support/accountApi.ts): the owner saves the fiscal data, asks for the invoice of an order,
 * uploads its two files from the queue and downloads them from the order.
 */

/** Opens a path of the area without reloading, as a click inside the page would. */
async function goTo(page: Page, path: string) {
  await page.evaluate(
    (target) => globalThis.history.pushState(null, '', target),
    path
  );
  await page.evaluate(() =>
    globalThis.dispatchEvent(new PopStateEvent('popstate'))
  );
}

test('fiscal data, request from the order, upload from the queue and download (FC 077)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'owner' });
  await page.goto('/cuenta/');
  await expect(page.getByRole('main').getByText(/^Hola, /)).toBeVisible();

  await goTo(page, '/cuenta/datos-fiscales/');
  const profile = page.getByRole('form', { name: 'Datos para factura' });
  await profile.getByLabel('RFC', { exact: true }).fill('XAXX010101000');
  await profile.getByLabel('Nombre o razón social').fill('La Rosa');
  await profile.getByLabel('Régimen fiscal').selectOption('612');
  await profile.getByLabel('Código postal fiscal').fill('98612');
  await profile.getByRole('button', { name: 'Guardar datos fiscales' }).click();
  await expect(
    page.getByText('Tus datos fiscales quedaron guardados.')
  ).toBeVisible();

  await goTo(page, `/cuenta/${E2E_ORDER}/`);
  await page.getByRole('button', { name: 'Pedir factura' }).click();
  const ask = page.getByRole('form', { name: 'Pedir factura' });
  await expect(ask.getByLabel('RFC', { exact: true })).toHaveValue(
    'XAXX010101000'
  );
  await ask.getByLabel('Correo para la factura').fill('ana@example.test');
  await ask.getByRole('button', { name: 'Enviar solicitud' }).click();
  await expect(
    page.getByText('La solicitud de factura quedó registrada.')
  ).toBeVisible();

  await goTo(page, '/cuenta/facturacion/');
  const upload = page.getByRole('form', {
    name: `Subir factura del pedido ${E2E_ORDER}`,
  });
  await upload.getByLabel('PDF de la factura').setInputFiles({
    name: 'factura.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7'),
  });
  await upload.getByLabel('XML de la factura').setInputFiles({
    name: 'factura.xml',
    mimeType: 'application/xml',
    buffer: Buffer.from('<x/>'),
  });
  await upload.getByRole('button', { name: 'Subir factura' }).click();
  await expect(page.getByText(/Factura registrada y enviada/)).toBeVisible();

  await goTo(page, `/cuenta/${E2E_ORDER}/`);
  await expect(
    page.getByRole('link', { name: 'Descargar PDF' })
  ).toHaveAttribute('href', new RegExp(`${E2E_ORDER}/invoice/pdf$`));
});
