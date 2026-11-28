import { expect, test } from '@playwright/test';
import {
  mockAccountApi,
  mockCatalogApi,
  openAccountMenu,
} from './support/accountApi';

/**
 * FC 078 F3 · The bilingual blocks of the catalog in a real browser: a required English field
 * folded away and empty opens itself when the form is sent, instead of failing without a word.
 */
test('a folded and empty required English name opens itself when saving (FC 078 T2.7)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'owner' });
  await mockCatalogApi(page);
  await page.goto('/cuenta/');
  await openAccountMenu(page);
  await page
    .getByRole('banner')
    .getByRole('link', { name: 'Administración' })
    .click();
  const main = page.getByRole('main');
  await main.getByRole('link', { name: /^Productos/ }).click();
  await main.getByRole('link', { name: /^Catálogo de productos/ }).click();
  await main
    .getByRole('button', { name: /^Editar/ })
    .first()
    .click();
  const form = page.getByRole('form', { name: 'Editar producto' });
  const english = form.getByLabel('Nombre en inglés');
  const summary = form.getByText('Inglés (obligatorio)');
  // It holds text, so it starts open; emptied and folded, saving opens it again.
  await english.fill('');
  await summary.click();
  await expect(english).toBeHidden();
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(english).toBeVisible();
  await expect(form).toBeVisible();
});
