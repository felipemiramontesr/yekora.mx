import { expect, type Page, test } from '@playwright/test';
import { mockAccountApi } from './support/accountApi';

/**
 * FC 055 and FC 078 · Where the store delivers, in the header. A visitor who allows the location in
 * the cookie notice sees where the browser is; the browser is never asked before that «yes»; and
 * with or without it a postal code can be typed in a dialog that only opens when asked for.
 * The geocoder is emulated, so no real position or service is involved.
 */
const GEOCODER = 'https://api-bdc.io/**';
const MEXICO_CITY = { latitude: 19.4326, longitude: -99.1332 };

/** The indicator of the header: a button that opens «Where do we deliver?». */
const indicator = (page: Page) =>
  page.getByRole('banner').getByRole('button', { name: /Enviar a|Deliver to/ });

test('a visitor who allows the location sees the postal code of the browser, resolved once per tab', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(MEXICO_CITY);
  const geocoderCalls: string[] = [];
  await page.route(GEOCODER, (route) => {
    geocoderCalls.push(route.request().url());
    return route.fulfill({ json: { postcode: '06600' } });
  });

  await page.goto('/nosotros/');
  await expect(
    page.getByRole('region', { name: 'Aviso de cookies' })
  ).toBeVisible();
  // Before the «yes» nothing is asked, and the header only invites.
  await expect(indicator(page)).toContainText('Ingresa tu C.P.');
  expect(geocoderCalls).toHaveLength(0);

  await page.getByRole('button', { name: 'Acepto', exact: true }).click();
  await expect(indicator(page)).toContainText('CDMX 06600');
  expect(geocoderCalls).toHaveLength(1);
  // The coordinates go to the geocoder, and only there.
  expect(geocoderCalls[0]).toContain('latitude=19.4326');

  // Another page of the same tab reuses the code: no second position, no second request.
  await page.reload();
  await expect(indicator(page)).toContainText('CDMX 06600');
  expect(geocoderCalls).toHaveLength(1);
});

test('without agreeing, a typed postal code is shown and kept in the tab; the browser is never asked (FC 078 T2.3, T2.6)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const calls = { count: 0 };
    Object.assign(globalThis, { __geolocationCalls: calls });
    globalThis.navigator.geolocation.getCurrentPosition = () => {
      calls.count += 1;
    };
  });
  await page.goto('/nosotros/');
  await page.getByRole('button', { name: 'No acepto' }).click();
  // The dialog never opens by itself.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await indicator(page).click();
  const dialog = page.getByRole('dialog', { name: '¿A dónde enviamos?' });
  const code = dialog.getByRole('textbox', { name: 'Código postal' });
  await code.fill('00');
  await dialog.getByRole('button', { name: 'Usar este código' }).click();
  await expect(dialog.getByText(/Ese código postal no existe/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(indicator(page)).toBeFocused();

  await indicator(page).click();
  await code.fill('98612');
  await dialog.getByRole('button', { name: 'Usar este código' }).click();
  await expect(dialog).toBeHidden();
  await expect(indicator(page)).toContainText('Zac. 98612');
  await page.reload();
  await expect(indicator(page)).toContainText('Zac. 98612');

  const stored = await page.evaluate(() => ({
    local: Object.values({ ...localStorage }).join(' '),
    session: Object.values({ ...sessionStorage }).join(' '),
    asked: (globalThis as unknown as { __geolocationCalls: { count: number } })
      .__geolocationCalls.count,
  }));
  expect(stored.local).not.toContain('98612');
  expect(stored.local).toContain('ZAC');
  expect(stored.session).toContain('98612');
  expect(stored.asked).toBe(0);
});

test('in English, and where no service knows a postal code the state alone is shown (FC 055 T2.9)', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 22.77, longitude: -102.58 });
  await page.route(GEOCODER, (route) =>
    route.fulfill({
      json: {
        postcode: '',
        countryCode: 'MX',
        principalSubdivisionCode: 'MX-ZAC',
      },
    })
  );
  await page.route('https://nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ json: { address: {} } })
  );
  await page.goto('/en/about/');
  await page.getByRole('button', { name: 'I accept', exact: true }).click();
  await expect(indicator(page)).toContainText('Deliver to');
  await expect(indicator(page)).toContainText('Zac.');
  await expect(indicator(page).locator('.sr-only')).toHaveText('Zacatecas');
});

test('an account chooses another of its addresses from the header (FC 078 T2.6)', async ({
  page,
}) => {
  await mockAccountApi(page, { signedIn: 'buyer' });
  // The static server has no fallback for the paths of the area: they are opened in the page.
  await page.goto('/cuenta/');
  await expect(page.getByRole('main').getByText(/^Hola, /)).toBeVisible();
  await page.evaluate(() =>
    globalThis.history.pushState(null, '', '/cuenta/datos/')
  );
  await page.evaluate(() =>
    globalThis.dispatchEvent(new PopStateEvent('popstate'))
  );
  // An address takes the name and phone of the account: they are saved first.
  const profile = page.getByRole('form', { name: 'Tus datos' });
  await profile.getByLabel('Teléfono').fill('4929421780');
  await profile.getByRole('button', { name: 'Guardar datos' }).click();
  await expect(page.getByText('Datos guardados.')).toBeVisible();
  const add = async (label: string, postal: string) => {
    await page.getByRole('button', { name: 'Agregar domicilio' }).click();
    const form = page.getByRole('form', { name: 'Nuevo domicilio' });
    await form.getByLabel('Nombre del domicilio').fill(label);
    await form.getByLabel('Calle').fill('Av. Barones');
    await form.getByLabel('Número exterior').fill('12');
    await form.getByLabel('Colonia').fill('Centro');
    await form.getByLabel('Municipio o alcaldía').fill('Municipio');
    await form.getByLabel('Código postal').fill(postal);
    await form.getByRole('button', { name: 'Guardar domicilio' }).click();
    await expect(page.getByText('Domicilio guardado.')).toBeVisible();
  };
  await add('Casa', '98612');
  await add('Oficina', '06600');
  await expect(indicator(page)).toContainText('Zac. 98612');
  await indicator(page).click();
  const dialog = page.getByRole('dialog', { name: '¿A dónde enviamos?' });
  await dialog.getByRole('button', { name: /Oficina/ }).click();
  await expect(dialog).toBeHidden();
  await expect(indicator(page)).toContainText('CDMX 06600');
});

for (const width of [320, 360, 768, 1280, 1920]) {
  test(`at ${width} px the header fits and the indicator keeps its box while it resolves (FC 078 T2.8)`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(MEXICO_CITY);
    await page.route(GEOCODER, (route) =>
      route.fulfill({ json: { postcode: '06600' } })
    );
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/nosotros/');
    await expect(indicator(page)).toContainText('Ingresa tu C.P.');
    const before = await indicator(page).boundingBox();
    await page.getByRole('button', { name: 'Acepto', exact: true }).click();
    await expect(indicator(page)).toContainText('CDMX 06600');
    const after = await indicator(page).boundingBox();
    expect(after?.height).toBe(before?.height);
    expect(after?.width).toBe(before?.width);
    expect(after?.y).toBe(before?.y);
    expect(after?.height).toBeGreaterThanOrEqual(44);
    const overflow = await page
      .locator('header')
      .evaluate((header) => header.scrollWidth - header.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
