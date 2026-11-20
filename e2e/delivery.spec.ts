import { expect, test } from '@playwright/test';

/**
 * FC 055 · Enmienda 1: the delivery postal code of the header, the way Amazon shows it. A visitor
 * who allows the location in the cookie notice sees the code of where the browser is; the browser
 * is never asked before that «yes»; and a refusal leaves the header silent, with no question.
 * The geocoder is emulated, so no real position or service is involved.
 */
const GEOCODER = 'https://api-bdc.io/**';
const MEXICO_CITY = { latitude: 19.4326, longitude: -99.1332 };

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
  const header = page.getByRole('banner');
  await expect(
    page.getByRole('region', { name: 'Aviso de cookies' })
  ).toBeVisible();
  // Before the «yes» nothing is shown and nothing is asked.
  await expect(header.getByText(/código postal|Tu CP|Agregar CP/)).toHaveCount(
    0
  );
  expect(geocoderCalls).toHaveLength(0);

  await page.getByRole('button', { name: 'Permitir ubicación' }).click();
  await expect(
    header.getByText('Enviar al código postal 06600')
  ).toBeAttached();
  await expect(header.getByText('06600', { exact: true })).toBeVisible();
  expect(geocoderCalls).toHaveLength(1);
  // The coordinates go to the geocoder, and only there.
  expect(geocoderCalls[0]).toContain('latitude=19.4326');

  // Another page of the same tab reuses the code: no second position, no second request.
  await page.reload();
  await expect(header.getByText('06600', { exact: true })).toBeVisible();
  expect(geocoderCalls).toHaveLength(1);
});

test('keeping only what is needed never asks the browser for its position', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation']);
  await page.addInitScript(() => {
    const calls = { count: 0 };
    Object.assign(globalThis, { __geolocationCalls: calls });
    globalThis.navigator.geolocation.getCurrentPosition = () => {
      calls.count += 1;
    };
  });
  await page.goto('/nosotros/');
  await page.getByRole('button', { name: 'Solo lo necesario' }).click();
  await expect(
    page.getByRole('region', { name: 'Aviso de cookies' })
  ).toBeHidden();
  await page.reload();
  const count = await page.evaluate(
    () =>
      (globalThis as unknown as { __geolocationCalls: { count: number } })
        .__geolocationCalls.count
  );
  expect(count).toBe(0);
  await expect(page.getByRole('banner').getByText(/código postal/)).toHaveCount(
    0
  );
});

test('a refused permission leaves the header silent: no code, no link, no alert', async ({
  page,
}) => {
  // No permission is granted, so the browser refuses the position.
  const messages: string[] = [];
  page.on('dialog', (dialog) => {
    messages.push(dialog.message());
    void dialog.dismiss();
  });
  await page.route(GEOCODER, (route) =>
    route.fulfill({ json: { postcode: '06600' } })
  );
  await page.goto('/nosotros/');
  await page.getByRole('button', { name: 'Permitir ubicación' }).click();
  await expect(
    page.getByRole('region', { name: 'Aviso de cookies' })
  ).toBeHidden();
  const header = page.getByRole('banner');
  await expect(header.getByText(/código postal|Tu CP|Agregar CP/)).toHaveCount(
    0
  );
  await expect(header.getByRole('link', { name: /postal|CP/ })).toHaveCount(0);
  expect(messages).toEqual([]);
});

test('in English the code is announced in English', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(MEXICO_CITY);
  await page.route(GEOCODER, (route) =>
    route.fulfill({ json: { postcode: '06600' } })
  );
  await page.goto('/en/about/');
  await page.getByRole('button', { name: 'Allow location' }).click();
  await expect(
    page.getByRole('banner').getByText('Deliver to postal code 06600')
  ).toBeAttached();
});
