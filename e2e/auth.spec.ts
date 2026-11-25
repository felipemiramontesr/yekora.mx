import { expect, test, type Page } from '@playwright/test';
import {
  E2E_RESET_TOKEN,
  mockAccountApi,
  mockCatalogApi,
  openAccountMenu,
} from './support/accountApi';
import { solidPng } from './support/imageFixtures';

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
  // FC 055 T2.2: sign-up asks for identity only; the postal code lives in the book of addresses.
  await expect(page.getByLabel(/código postal/i)).toHaveCount(0);
  // FC 067: the language of the mail starts as the page's, and the person can pick the other.
  const language = page.getByLabel('Idioma de tus correos');
  await expect(language).toHaveValue('es-MX');
  await language.selectOption('en');
  const sent = page.waitForRequest('**/v1/auth/register');
  await submit.click();
  expect((await sent).postDataJSON()).toEqual({
    email: 'ana@example.test',
    password: STRONG,
    fullName: 'Ana Prueba',
    preferredLocale: 'en',
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
  // Enmienda 2: the link names its account, and the personal rule is checked against it.
  await expect(
    page.getByText('Cambiando la contraseña de ana@example.test')
  ).toBeVisible();
  const submit = page.getByRole('button', { name: 'Guardar contraseña nueva' });
  await expect(submit).toBeDisabled();
  const field = page.getByLabel('Contraseña nueva', { exact: true });
  await field.fill('Ana-E2E-Nevado7#');
  await page.getByLabel('Repetir contraseña nueva').fill('Ana-E2E-Nevado7#');
  await expect(submit).toBeDisabled();
  await field.fill(STRONG);
  await page.getByLabel('Repetir contraseña nueva').fill(STRONG);
  await submit.click();
  await expect(page.getByText(/^Listo: tu contraseña cambió/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
});

test('a spent or expired link says so and offers another', async ({ page }) => {
  await mockAccountApi(page);
  await page.goto(`/cuenta/?action=reset-password&token=${'f'.repeat(64)}`);
  // Enmienda 2: the link is checked on opening, so no password is asked for a dead one.
  await expect(page.locator('main').getByRole('alert')).toHaveText(
    'El enlace venció o ya se usó. Pide otro.'
  );
  await expect(
    page.getByLabel('Contraseña nueva', { exact: true })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Pedir otro enlace' }).click();
  await expect(
    page.getByRole('heading', { name: 'Restablecer tu contraseña' })
  ).toBeVisible();
});

/**
 * FC 072 F2 · The staff tab of the panel «Usuarios, roles y permisos» of the owner, against the
 * emulated `/v1/admin/users` and `/v1/admin/roles`: the owner's badge and card, the protected
 * owner row, an invitation with roles and without any password, switching an account off, changing
 * its roles and the refusal of a person already in the staff.
 */
test('the owner invites, switches off and changes the roles of the staff; the owner row has no controls (FC 072 T1.1, T2.1, T2.4)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'owner' });
  await page.goto('/cuenta/');
  await expect(page.getByRole('main').getByText('Hola, GrayMan')).toBeVisible();
  // FC 047: the badge and the sections of the owner are in the account menu of the header.
  const header = page.getByRole('banner');
  await header.locator('summary').click();
  await expect(header.getByText('Owner', { exact: true })).toBeVisible();
  await header.getByRole('link', { name: 'Administración' }).click();
  await page
    .getByRole('main')
    .getByRole('link', { name: /^Usuarios, roles y permisos/ })
    .click();
  await expect(page).toHaveURL(/\/cuenta\/usuarios\/$/);
  const row = (name: string) => page.getByRole('row').filter({ hasText: name });
  await expect(row('GrayMan')).toContainText(
    'Protegida: nadie puede cambiarla'
  );
  await expect(row('GrayMan').getByRole('button')).toHaveCount(0);
  await expect(row('Zoe E2E')).toContainText('Administrador');
  // T2.4: an invitation is a name, an e-mail and roles; the page has no password field at all.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  const invite = page
    .getByRole('heading', { name: 'Invitar a una persona al personal' })
    .locator('xpath=ancestor::form');
  await page.getByLabel('Nombre').fill('Leo Nuevo');
  await page.getByLabel('Correo').fill('leo@example.test');
  await invite.getByLabel('Vendedor').check();
  await page.getByRole('button', { name: 'Enviar invitación' }).click();
  await expect(
    page.getByText('Listo. Enviamos el enlace a leo@example.test.')
  ).toBeVisible();
  await expect(row('Leo Nuevo')).toContainText('Vendedor');
  await expect(row('Leo Nuevo')).toContainText('Sin activar');
  await page.getByRole('button', { name: 'Desactivar: Zoe E2E' }).click();
  await expect(row('Zoe E2E')).toContainText('Desactivada');
  await page.getByRole('button', { name: 'Cambiar roles: Zoe E2E' }).click();
  const roles = page.getByRole('group', { name: 'Roles de Zoe E2E' });
  await roles.getByLabel('Administrador').uncheck();
  await roles.getByLabel('Staff · Catálogo').check();
  await roles
    .locator('xpath=ancestor::form')
    .getByRole('button', { name: 'Guardar roles' })
    .click();
  await expect(row('Zoe E2E')).toContainText('Staff · Catálogo');
  await expect(row('Zoe E2E')).not.toContainText('Administrador');
  // A second invitation of the same e-mail is refused by name.
  await page.getByLabel('Nombre').fill('Leo Nuevo');
  await page.getByLabel('Correo').fill('leo@example.test');
  await invite.getByLabel('Vendedor').check();
  await page.getByRole('button', { name: 'Enviar invitación' }).click();
  await expect(
    page.getByText(
      'Esa persona ya es parte del personal; cambia sus roles en la lista.'
    )
  ).toBeVisible();
});

test('the owner creates a role from a template and edits its permissions in the matrix, confirming the summary (FC 072 F3, T1.2, T2.7)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'owner' });
  await page.goto('/cuenta/');
  const header = page.getByRole('banner');
  await header.locator('summary').click();
  await header.getByRole('link', { name: 'Administración' }).click();
  await page
    .getByRole('main')
    .getByRole('link', { name: /^Usuarios, roles y permisos/ })
    .click();
  await page.getByRole('tab', { name: 'Roles' }).click();
  await expect(
    page.getByRole('row').filter({ hasText: 'Vendedor' })
  ).toContainText('El dueño y los administradores');
  // The owner and the buyer are roles of the system: nothing in their rows can change them.
  await expect(
    page
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: 'Dueño', exact: true }) })
  ).toContainText('Del sistema: no se edita');
  await page.getByRole('button', { name: 'Bodeguero' }).click();
  await expect(page.getByLabel('Identificador')).toHaveValue('warehouse');
  await page.getByRole('button', { name: 'Crear rol' }).click();
  await expect(
    page.getByText('Listo. Creamos el rol Bodeguero.')
  ).toBeVisible();
  await expect(
    page.getByRole('row').filter({ hasText: 'Bodeguero' })
  ).toContainText('warehouse');
  await page.getByRole('tab', { name: 'Permisos' }).click();
  // T2.7: account:self and roles:manage are locked in every role; users:manage only in the administrator's.
  await expect(
    page.getByRole('checkbox', {
      name: 'Ver y editar su propia cuenta: Bodeguero',
    })
  ).toBeDisabled();
  await expect(
    page.getByRole('checkbox', {
      name: 'Crear y editar roles y la matriz: Bodeguero',
    })
  ).toBeDisabled();
  await expect(
    page.getByRole('checkbox', {
      name: 'Administrar cuentas de usuarios: Bodeguero',
    })
  ).toBeDisabled();
  const seeBoard = page.getByRole('checkbox', {
    name: 'Ver el tablero de devoluciones: Bodeguero',
  });
  await expect(seeBoard).not.toBeChecked();
  await seeBoard.check();
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(
    page.getByRole('heading', { name: 'Confirma los cambios' })
  ).toBeVisible();
  await expect(
    page.getByText('Se agrega: Ver el tablero de devoluciones')
  ).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar y guardar' }).click();
  await expect(page.getByText('Matriz guardada.')).toBeVisible();
  await expect(seeBoard).toBeChecked();
});

test('the panel of users and roles has its own address in English, and only who may manage the staff is offered it (FC 072 T1.1)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'owner' });
  await page.goto('/en/account/');
  await openAccountMenu(page);
  await page.getByRole('link', { name: 'Administration' }).click();
  await page
    .getByRole('main')
    .getByRole('link', { name: /^Users, roles and permissions/ })
    .click();
  await expect(page).toHaveURL(/\/en\/account\/usuarios\/$/);
  await expect(
    page.getByRole('row').filter({ hasText: 'GrayMan' })
  ).toContainText('Protected: nobody can change it');
  await page.unrouteAll({ behavior: 'wait' });
  await mockAccountApi(page, { signedIn: 'staff' });
  await page.goto('/en/account/');
  await expect(page.getByText('Hello, Luis E2E')).toBeVisible();
  // Staff with only the panel's orders see «Administración» and one card, never the owner's.
  await openAccountMenu(page);
  await page.getByRole('link', { name: 'Administration' }).click();
  await expect(
    page.getByRole('region', { name: 'Administration' }).getByRole('link')
  ).toHaveCount(1);
  await expect(
    page
      .getByRole('main')
      .getByRole('link', { name: /^Users, roles and permissions/ })
  ).toHaveCount(0);
});

/**
 * FC 029 F3d · The photo crop in the real browser. jsdom has no Canvas, so this is where
 * `createImageBitmap`, the 2D context and `toBlob` actually run, in WebKit too, which cannot
 * encode WebP and answers with another type: the console must then fall back to JPEG.
 */
test('the owner crops a photo in the browser Canvas and uploads it at the chosen width (FC 029 T1.2 D)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'owner' });
  const uploadsSoFar = await mockCatalogApi(page);
  await page.goto('/cuenta/');
  await openAccountMenu(page);
  await page
    .getByRole('banner')
    .getByRole('link', { name: 'Administración' })
    .click();
  await page
    .getByRole('main')
    .getByRole('link', { name: /^Productos/ })
    .click();
  await expect(page).toHaveURL(/\/cuenta\/catalogo\/productos\/$/);
  await page.getByRole('button', { name: 'Galería: Tenis trail E2E' }).click();
  // A real modal: it opens over the page, Escape closes it, and the page can open it again.
  await page.getByRole('button', { name: 'Agregar foto' }).click();
  await expect(page.getByRole('dialog', { name: 'Nueva foto' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Nueva foto' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Agregar foto' }).click();
  await page.getByLabel('Elige una foto (JPG, PNG o WebP)').setInputFiles({
    name: 'foto.png',
    mimeType: 'image/png',
    buffer: solidPng(40, 20),
  });
  await expect(
    page.getByText('Vista previa del recorte cuadrado')
  ).toBeVisible();
  await page.getByLabel('Acercamiento').fill('2');
  await page.getByLabel('Tamaño de la foto').selectOption('600');
  await page.getByRole('button', { name: 'Usar esta foto' }).click();
  await expect(page.locator('ol img')).toHaveCount(1);
  // The Canvas produced a square at the width asked, as WebP or, where it cannot, as JPEG.
  const uploads = await uploadsSoFar();
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toMatchObject({ width: 600, height: 600 });
  expect(uploads[0].type).toMatch(/^image\/(webp|jpeg)$/);
  await page.getByLabel('Texto alternativo en español').fill('Tenis de frente');
  await page.getByRole('button', { name: 'Guardar galería' }).click();
  await expect(page.getByText('Galería guardada.')).toBeVisible();
});
