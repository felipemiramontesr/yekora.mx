import { expect, test } from '@playwright/test';
import { E2E_ORDER, mockAccountApi } from './support/accountApi';

/**
 * FC 068 F1 · The fulfillment of an order in a real browser, against the emulated account API
 * (e2e/support/accountApi.ts, which admits the steps in the order the API does): the owner opens
 * an order of the panel, prepares it, ships it with its carrier and tracking number, and marks it
 * delivered, and the parcel shows with a link that opens apart. Staff who only read orders see
 * the order and its state but no controls.
 */

const panel = `/cuenta/panel/`;

test('the owner prepares, ships and delivers an order from its panel page (FC 068 T1.1)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'owner' });
  await page.goto('/cuenta/');
  await expect(page.getByRole('main').getByText(/^Hola, /)).toBeVisible();
  await page.evaluate(
    (path) => globalThis.history.pushState(null, '', path),
    `${panel}${E2E_ORDER}/`
  );
  await page.evaluate(() =>
    globalThis.dispatchEvent(new PopStateEvent('popstate'))
  );
  await expect(
    page.getByRole('region', { name: 'Cumplimiento del pedido' })
  ).toBeVisible();

  await page.getByRole('button', { name: 'Empezar a preparar' }).click();
  await expect(
    page.getByText('Listo. El pedido quedó «En preparación».')
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Empezar a preparar' })
  ).toHaveCount(0);

  const form = page.getByRole('form', { name: 'Datos del envío' });
  await form.getByLabel('Transportista').fill('DHL');
  await form.getByLabel('Guía de rastreo').fill('1234567890');
  await form
    .getByLabel('Enlace de rastreo (opcional)')
    .fill('https://www.dhl.com/track?id=1234567890');
  await form.getByRole('button', { name: 'Registrar el envío' }).click();
  await expect(
    page.getByText('Listo. El pedido quedó «Enviado».')
  ).toBeVisible();
  const link = page.getByRole('link', { name: 'Rastrear el envío' });
  await expect(link).toHaveAttribute(
    'href',
    'https://www.dhl.com/track?id=1234567890'
  );
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(page.getByText('1234567890')).toBeVisible();

  await page.getByRole('button', { name: 'Marcar como entregado' }).click();
  await expect(
    page.getByText('Listo. El pedido quedó «Entregado».')
  ).toBeVisible();
  await expect(
    page.getByText('Este pedido no admite más acciones.')
  ).toBeVisible();
});

test('staff who only read orders see the order and no controls', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'staff' });
  await page.goto('/cuenta/');
  await expect(page.getByRole('main').getByText(/^Hola, /)).toBeVisible();
  await page.evaluate(
    (path) => globalThis.history.pushState(null, '', path),
    `${panel}${E2E_ORDER}/`
  );
  await page.evaluate(() =>
    globalThis.dispatchEvent(new PopStateEvent('popstate'))
  );
  await expect(page.getByText(`Pedido ${E2E_ORDER}`)).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Cumplimiento del pedido' })
  ).toHaveCount(0);
});
