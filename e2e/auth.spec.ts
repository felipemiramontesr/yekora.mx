import { expect, test, type Page } from '@playwright/test';
import { E2E_RESET_TOKEN, mockAccountApi } from './support/accountApi';

/**
 * FC 042 F2 · Passwords in a real browser, against the emulated account API
 * (e2e/support/accountApi.ts, which applies the same password policy as the API): the eye of
 * every password field, sign-up with the repeated password and the live list of rules,
 * «¿Olvidaste tu contraseña?» and the page of the mailed link.
 */

/** Meets every rule of the policy for «Ana Prueba». */
const STRONG = 'Ruta-Nevado7#Sur';

/** Opens /cuenta/ once React owns the sign-in form (FC 043 T2.2: fields enabled at hydration). */
async function signInForm(page: Page) {
  await mockAccountApi(page);
  await page.goto('/cuenta/');
  await expect(page.getByLabel('Correo electrónico')).toBeEnabled();
}

/** Whether the line of the live list for `text` reads «Cumple». */
async function met(page: Page, text: string) {
  const item = page.getByRole('listitem').filter({ hasText: text });
  return (await item.textContent())?.startsWith('Cumple:') ?? false;
}

test('every password field has its own eye, which shows and hides it (T1.3, T2.5)', async ({
  page,
}) => {
  await signInForm(page);
  const password = page.getByLabel('Contraseña', { exact: true });
  await password.fill(STRONG);
  const eye = page.getByRole('button', { name: 'Mostrar contraseña' });
  await expect(eye).toHaveAttribute('aria-pressed', 'false');
  await eye.click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(
    page.getByRole('button', { name: 'Ocultar contraseña' })
  ).toHaveAttribute('aria-pressed', 'true');
  // The eye never submits the form.
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page
    .getByRole('button', { name: '¿No tienes cuenta? Crea una' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Mostrar contraseña' })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Mostrar la contraseña repetida' })
    .click();
  await expect(page.getByLabel('Repetir contraseña')).toHaveAttribute(
    'type',
    'text'
  );
});

test('sign-up turns its button on only when every rule is met and both match; the repetition never travels (T1.4, T2.7)', async ({
  page,
}) => {
  await signInForm(page);
  await page
    .getByRole('button', { name: '¿No tienes cuenta? Crea una' })
    .click();
  const submit = page.getByRole('button', { name: 'Crear cuenta' });
  await page.getByLabel('Nombre completo').fill('Ana Prueba');
  await page.getByLabel('Correo electrónico').fill('ana@example.test');
  await page.getByLabel('Contraseña', { exact: true }).fill('ana-prueba');
  await expect(submit).toBeDisabled();
  expect(await met(page, 'Una letra mayúscula')).toBe(false);
  expect(await met(page, 'No incluir tu correo ni tu nombre')).toBe(false);
  await page.getByLabel('Contraseña', { exact: true }).fill(STRONG);
  expect(await met(page, 'Una letra mayúscula')).toBe(true);
  expect(await met(page, 'No incluir tu correo ni tu nombre')).toBe(true);
  await page.getByLabel('Repetir contraseña').fill(`${STRONG}x`);
  expect(await met(page, 'Las dos contraseñas coinciden')).toBe(false);
  await expect(submit).toBeDisabled();
  await page.getByLabel('Repetir contraseña').fill(STRONG);
  expect(await met(page, 'Las dos contraseñas coinciden')).toBe(true);
  await expect(submit).toBeEnabled();
  const sent = page.waitForRequest('**/v1/auth/register');
  await submit.click();
  expect((await sent).postDataJSON()).toEqual({
    email: 'ana@example.test',
    password: STRONG,
    fullName: 'Ana Prueba',
    altcha: expect.any(String),
  });
  await expect(
    page.getByText(/^Listo\. Si el correo no tenía cuenta/)
  ).toBeVisible();
});

test('«¿Olvidaste tu contraseña?» sends the link and says the same for any e-mail (T1.1)', async ({
  page,
}) => {
  await signInForm(page);
  await page.getByLabel('Correo electrónico').fill('ana@example.test');
  await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();
  await expect(
    page.getByRole('heading', { name: 'Restablecer tu contraseña' })
  ).toBeVisible();
  await expect(page.getByLabel('Correo electrónico')).toHaveValue(
    'ana@example.test'
  );
  await page.getByRole('button', { name: 'Enviar enlace' }).click();
  await expect(
    page.getByText('Si el correo está registrado, te enviamos un enlace.', {
      exact: false,
    })
  ).toBeVisible();
});

test('the mailed link opens the new-password form, leaves the address and changes the password (T1.2)', async ({
  page,
}) => {
  await mockAccountApi(page);
  await page.goto(`/cuenta/?action=reset-password&token=${E2E_RESET_TOKEN}`);
  await expect(
    page.getByRole('heading', { name: 'Elige tu contraseña nueva' })
  ).toBeVisible();
  await expect(page).toHaveURL(/\/cuenta\/$/);
  const submit = page.getByRole('button', { name: 'Guardar contraseña nueva' });
  await expect(submit).toBeDisabled();
  await page.getByLabel('Contraseña nueva', { exact: true }).fill(STRONG);
  await page.getByLabel('Repetir contraseña nueva').fill(STRONG);
  await submit.click();
  await expect(page.getByText(/^Listo: tu contraseña cambió/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
});

test('a spent or expired link says so and offers another', async ({ page }) => {
  await mockAccountApi(page);
  await page.goto(`/cuenta/?action=reset-password&token=${'f'.repeat(64)}`);
  await page.getByLabel('Contraseña nueva', { exact: true }).fill(STRONG);
  await page.getByLabel('Repetir contraseña nueva').fill(STRONG);
  await page.getByRole('button', { name: 'Guardar contraseña nueva' }).click();
  await expect(page.locator('main').getByRole('alert')).toHaveText(
    'El enlace venció o ya se usó. Pide otro.'
  );
  await page.getByRole('button', { name: 'Pedir otro enlace' }).click();
  await expect(
    page.getByRole('heading', { name: 'Restablecer tu contraseña' })
  ).toBeVisible();
});
