import { expect, type Page, test } from '@playwright/test';
import { E2E_ORDER, mockAccountApi } from './support/accountApi';

/**
 * FC 073 · The returns in a real browser, against the emulated account API
 * (e2e/support/accountApi.ts, which admits each step in the stage the API does): the buyer asks for
 * a return from a delivered order, and the owner prepares one request and confirms another on
 * the board; confirming what the same person prepared is refused with the explanation (T2.1).
 */

/** Opens a path of the area without reloading, as a click inside the page would. */
async function goTo(page: Page, path: string) {
  await page.goto('/cuenta/');
  await expect(page.getByRole('main').getByText(/^Hola, /)).toBeVisible();
  await page.evaluate(
    (target) => globalThis.history.pushState(null, '', target),
    path
  );
  await page.evaluate(() =>
    globalThis.dispatchEvent(new PopStateEvent('popstate'))
  );
}

test('the buyer asks for a return from a delivered order, and the offer closes once every unit is asked (FC 073 F2, T1.1)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'buyer', delivered: true });
  await goTo(page, `/cuenta/${E2E_ORDER}/`);
  await page.getByRole('button', { name: 'Solicitar devolución' }).click();
  const form = page.getByRole('form', { name: 'Solicitar una devolución' });
  await expect(form.getByText(/Tienes 60 días naturales/)).toBeVisible();
  await form.getByLabel(/Piezas de E2E-0001/).fill('1');
  await form.getByLabel('Motivo').selectOption('DEFECT');
  await form
    .getByLabel('Comentario (opcional)')
    .fill('La cremallera llegó rota.');
  await form.getByRole('button', { name: 'Enviar solicitud' }).click();
  await expect(
    page.getByText(/Recibimos tu solicitud de devolución/)
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Solicitar devolución' })
  ).toHaveCount(0);
});

test('an order that is not delivered offers no return (FC 073 T1.1)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'buyer' });
  await goTo(page, `/cuenta/${E2E_ORDER}/`);
  await expect(page.getByText(`Pedido ${E2E_ORDER}`)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Solicitar devolución' })
  ).toHaveCount(0);
});

test('the owner prepares a refund, cannot confirm what they prepared, and confirms what someone else prepared (FC 073 F1, T1.2, T2.1)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'owner', seedReturns: true });
  await goTo(page, '/cuenta/devoluciones/');
  const request = page
    .getByRole('listitem')
    .filter({ hasText: 'Pedido YEK-2026-E2E00001' });
  const prepared = page
    .getByRole('listitem')
    .filter({ hasText: 'Pedido YEK-2026-E2E00002' });
  await expect(request).toContainText('Llegó roto');
  await request.getByRole('button', { name: 'Preparar reembolso' }).click();
  await request.getByLabel('Monto a reembolsar (MXN)').fill('4850.00');
  await request
    .getByRole('form')
    .getByRole('button', { name: 'Preparar reembolso' })
    .click();
  await expect(
    page.getByText(/El reembolso del pedido YEK-2026-E2E00001 quedó preparado/)
  ).toBeVisible();
  // The same person confirming what they prepared: refused, with the explanation, board intact.
  await request.getByRole('button', { name: 'Confirmar reembolso' }).click();
  await request
    .getByRole('form')
    .getByRole('button', { name: 'Confirmar reembolso' })
    .click();
  await expect(
    page.getByText('Otra persona debe confirmar lo que tú preparaste.')
  ).toBeVisible();
  // What someone else prepared, the owner confirms.
  await prepared.getByRole('button', { name: 'Confirmar reembolso' }).click();
  await prepared
    .getByRole('form')
    .getByRole('button', { name: 'Confirmar reembolso' })
    .click();
  await expect(
    page.getByText('Listo. El pedido YEK-2026-E2E00002 quedó reembolsado.')
  ).toBeVisible();
});

test('the board of returns has its own address in English (FC 073 T0.2)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'owner', seedReturns: true });
  await page.goto('/en/account/');
  await expect(page.getByRole('main').getByText(/^Hello, /)).toBeVisible();
  await page.evaluate(() =>
    globalThis.history.pushState(null, '', '/en/account/devoluciones/')
  );
  await page.evaluate(() =>
    globalThis.dispatchEvent(new PopStateEvent('popstate'))
  );
  await expect(
    page.getByRole('heading', { name: 'Return requests' })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Prepare refund' })
  ).toBeVisible();
});
