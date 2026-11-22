import { expect, test, type Page } from '@playwright/test';
import { mockAccountApi } from './support/accountApi';
import { mockQuoteApi } from './support/quoteApi';

/**
 * FC 062 F1 · The flow guards in a real browser: every page that depends on a previous step is
 * opened directly, and shows a useful state instead of a blank page, an empty form or a total of
 * $0.00. The cart, the quote and the account are the emulations of e2e/support. The sub-path
 * `/cuenta/{pedido}/` of an unknown order is covered in account.test.tsx: the local static
 * server has no Apache fallback for it.
 */

/** Opens a page with these lines already in the pack. */
async function openWith(
  page: Page,
  lines: { sku: string; quantity: number }[],
  path: string
) {
  await page.addInitScript((stored) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('yekora_cart_v1', stored);
      sessionStorage.setItem('seeded', '1');
    }
  }, JSON.stringify(lines));
  await page.goto(path);
}

test('an empty pack opens /checkout/ as «Tu mochila está vacía», with no form and no total (K-92)', async ({
  page,
}) => {
  await mockQuoteApi(page);
  await page.goto('/checkout/');
  const main = page.getByRole('main');
  await expect(main.getByText('Tu mochila está vacía')).toBeVisible();
  await expect(main.getByRole('link', { name: 'Ver catálogo' })).toBeVisible();
  await expect(main.locator('form')).toHaveCount(0);
  await expect(main.getByText('$0.00')).toHaveCount(0);
});

test('a pack with only out-of-stock products opens /checkout/ as «ya no están disponibles», with links to the pack and the catalog (K-92)', async ({
  page,
}) => {
  await mockQuoteApi(page);
  await openWith(page, [{ sku: 'E2E-0003', quantity: 1 }], '/checkout/');
  const main = page.getByRole('main');
  await expect(
    main.getByText('Tus productos ya no están disponibles')
  ).toBeVisible();
  await expect(
    main.getByRole('link', { name: 'Ver mi mochila' })
  ).toHaveAttribute('href', '/carrito/');
  await expect(main.getByRole('link', { name: 'Ver catálogo' })).toBeVisible();
  await expect(main.locator('form')).toHaveCount(0);
  await expect(main.getByText('$0.00')).toHaveCount(0);
});

for (const [path, name] of [
  ['/checkout/exito/', 'success'],
  ['/checkout/cancelado/', 'cancel'],
] as const) {
  test(`${path} opened directly, with no order of this tab, shows the not-found state with its links (${name}, K-92)`, async ({
    page,
  }) => {
    await mockQuoteApi(page);
    await page.goto(path);
    const main = page.getByRole('main');
    await expect(main.getByText(/No encontramos/)).toBeVisible();
    await expect(main.getByRole('link').first()).toBeVisible();
    await expect(main.getByText('Cargando')).toHaveCount(0);
  });
}

test('a reset link with no token opens the form that asks for a new one, saying why, and the token-less address leaves the bar (K-92)', async ({
  page,
}) => {
  await mockAccountApi(page);
  await page.goto('/cuenta/?action=reset-password');
  await expect(
    page.getByRole('heading', { name: 'Restablecer tu contraseña' })
  ).toBeVisible();
  await expect(
    page.getByText(/enlace para cambiar tu contraseña está incompleto/)
  ).toBeVisible();
  await expect(page).toHaveURL(/\/cuenta\/$/);
});

test('«Continuar al pago» closes the pack panel as it goes to /checkout/ (K-86)', async ({
  page,
}) => {
  await mockQuoteApi(page);
  await openWith(page, [{ sku: 'E2E-0001', quantity: 1 }], '/catalogo/');
  await page
    .getByRole('banner')
    .getByRole('link', { name: /mochila/i })
    .click();
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  await panel.getByRole('link', { name: 'Continuar al pago' }).click();
  await expect(page).toHaveURL(/\/checkout\/$/);
  await expect(panel).toBeHidden();
});
