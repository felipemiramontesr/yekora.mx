import { expect, test, type Page } from '@playwright/test';

// The static export as Hostinger serves it (FC 003): Spanish at the root, English under /en/
// with translated slugs, no locale redirect and no language cookie.

/**
 * FC 047: the navigation that lives in the account menu of the header (the language, and the
 * sections of the account), a <details> that is opened first. The disciplines are not here: they
 * are the strip under the bar, always in view.
 */
async function headerNav(page: Page, name: string | RegExp) {
  const menu = page.getByRole('banner').locator('details');
  const closed = await menu.evaluate((d) => !(d as HTMLDetailsElement).open);
  // Opened only when closed: a second click on the summary would fold it again.
  if (closed) await menu.locator('summary').click();
  return page
    .getByRole('navigation', { name })
    .filter({ visible: true })
    .first();
}

test('the root is the Spanish home page, whatever the browser language', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle('YĒKORA | Tienda Outdoor');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-MX');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Equipo adecuado'
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://yekora.mx/'
  );
});

test('the English home page lives under /en/ with its hreflang pair', async ({
  page,
}) => {
  await page.goto('/en/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'The right gear'
  );
  await expect(page.locator('link[hreflang="es-MX"]')).toHaveAttribute(
    'href',
    'https://yekora.mx/'
  );
  await expect(page.locator('link[hreflang="x-default"]')).toHaveAttribute(
    'href',
    'https://yekora.mx/'
  );
});

test('each discipline of the strip leads to its products, in the current language (FC 047 T2.1)', async ({
  page,
}) => {
  await page.goto('/');
  const strip = page.getByRole('navigation', { name: 'Disciplinas' }).first();
  await expect(strip.getByRole('link', { name: 'Escalada' })).toHaveAttribute(
    'href',
    '/catalogo/?disciplina=escalada'
  );
  await strip.getByRole('link', { name: 'Escalada' }).click();
  await expect(page).toHaveURL(/\/catalogo\/\?disciplina=escalada$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/en/');
  await expect(
    page
      .getByRole('navigation', { name: 'Disciplines' })
      .first()
      .getByRole('link', { name: 'Mountaineering' })
  ).toHaveAttribute('href', '/en/catalog/?disciplina=montana');
  // The header has no «Catálogo» link any more: the disciplines are the way in.
  await expect(
    page.getByRole('banner').getByRole('link', { name: /^Catálogo$/ })
  ).toHaveCount(0);
});

test('switching language opens the same page in the other language, with no cookie', async ({
  page,
  context,
}) => {
  await page.goto('/nosotros/');
  const switcher = await headerNav(page, 'Idioma');
  await switcher.getByRole('link', { name: 'EN, English' }).click();
  await expect(page).toHaveURL(/\/en\/about\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('About us');

  await (
    await headerNav(page, 'Language')
  )
    .getByRole('link', { name: 'ES, Español' })
    .click();
  await expect(page).toHaveURL(/\/nosotros\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-MX');
  expect(await context.cookies()).toEqual([]);
});

test('the cookie notice describes its single technical cookie and stays dismissed', async ({
  page,
  context,
}) => {
  await page.goto('/');
  const banner = page.getByRole('region', { name: 'Aviso de cookies' });
  await expect(banner).toContainText('solo usa una cookie técnica');
  await banner.getByRole('button', { name: 'Entendido' }).click();
  await expect(banner).toBeHidden();
  const cookies = await context.cookies();
  expect(cookies.map((cookie) => cookie.name)).toEqual([
    'yekora_cookie_consent',
  ]);
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Aviso de cookies' })
  ).toBeHidden();
});

test('legal pages are reachable from the footer in both languages', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('contentinfo')
    .getByRole('link', { name: 'Aviso de privacidad' })
    .click();
  await expect(page).toHaveURL(/\/privacidad\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Aviso de privacidad'
  );

  await page.goto('/en/');
  await page
    .getByRole('contentinfo')
    .getByRole('link', { name: 'Cookie policy' })
    .click();
  await expect(page).toHaveURL(/\/en\/cookies\/$/);
  await expect(page.getByRole('table')).toContainText('yekora_cookie_consent');
  await expect(page.getByRole('table')).not.toContainText('yekora_locale');

  await page.goto('/terminos/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Términos y condiciones'
  );
  await page.goto('/en/terms/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Terms and conditions of use'
  );
});

test('internal links change page without reloading the document (FC 043 T2.3)', async ({
  page,
}) => {
  await page.goto('/cuenta/');
  // The sign-in field turns enabled at hydration (FC 043 T2.2): from here links are client-side.
  await expect(page.getByLabel('Correo electrónico')).toBeEnabled();
  // A full reload would build a new window and lose this mark.
  await page.evaluate(() => {
    (window as Window & { sameDocument?: boolean }).sameDocument = true;
  });
  await page
    .getByRole('navigation', { name: 'Disciplinas' })
    .first()
    .getByRole('link', { name: 'Escalada' })
    .click();
  await expect(page).toHaveURL(/\/catalogo\/\?disciplina=escalada$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as Window & { sameDocument?: boolean }).sameDocument
    )
  ).toBe(true);
  // The header stays mounted, so its menu is still closed after the click.
  const menu = page.getByRole('banner').locator('details');
  expect(await menu.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(
    false
  );
});

test('the account menu opens without client JavaScript and holds the language (FC 047 T2.4)', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 360, height: 800 },
  });
  const page = await context.newPage();
  await page.goto('/');
  // Below xl the menu shows only its icon; its name stays for assistive technology.
  await page.getByRole('banner').locator('summary').click();
  const menu = page.getByRole('banner').locator('details');
  await expect(menu.getByRole('link', { name: 'Entrar' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Crear cuenta' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'EN, English' })).toBeVisible();
  // The strip of disciplines needs no menu at all.
  await expect(
    page.getByRole('link', { name: 'Cañonismo' }).first()
  ).toBeVisible();
  await context.close();
});

test('the shipping and returns policy is one footer click away in both languages', async ({
  page,
  context,
  baseURL,
}) => {
  // On a phone the fixed cookie notice covers the end of the footer until it is answered.
  await context.addCookies([
    { name: 'yekora_cookie_consent', value: '1', url: baseURL ?? '' },
  ]);
  for (const [home, link, path, heading] of [
    [
      '/',
      'Envíos y devoluciones',
      /\/envios-y-devoluciones\/$/,
      'Envíos y devoluciones',
    ],
    [
      '/en/',
      'Shipping and returns',
      /\/en\/shipping-and-returns\/$/,
      'Shipping and returns',
    ],
  ] as const) {
    await page.goto(home);
    await page
      .getByRole('contentinfo')
      .getByRole('link', { name: link })
      .click();
    await expect(page).toHaveURL(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await expect(page.locator('main')).toContainText('30');
  }
});

// Ω's rule (FC 005, I-AntiPending): no page shows a placeholder or a draft notice.
test('legal pages show the real controller and nothing pending', async ({
  page,
}) => {
  for (const path of [
    '/privacidad/',
    '/terminos/',
    '/cookies/',
    '/envios-y-devoluciones/',
    '/en/privacy/',
    '/en/terms/',
    '/en/cookies/',
    '/en/shipping-and-returns/',
  ]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(
      /Pendiente|Pending|revisión jurídica|legal review/
    );
  }
  await page.goto('/privacidad/');
  await expect(page.locator('main')).toContainText('Ana Karen Flores Baca');
  await expect(page.locator('main')).toContainText('contacto@yekora.mx');
});

test('an unknown path is a branded 404 that leads back home in both languages', async ({
  page,
}) => {
  const response = await page.goto('/no-existe/');
  expect(response?.status()).toBe(404);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-MX');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Ruta no encontrada'
  );
  await expect(
    page.getByRole('link', { name: 'Volver al sendero principal' })
  ).toHaveAttribute('href', '/');
  await expect(
    page.getByRole('link', { name: 'Back to the home trail' })
  ).toHaveAttribute('href', '/en/');
});

test('the tab shows the YĒKORA favicon', async ({ page, request }) => {
  await page.goto('/');
  const svgIcon = await page
    .locator('link[rel="icon"][type="image/svg+xml"]')
    .getAttribute('href');
  expect(svgIcon).toMatch(/^\/icon\.svg/);
  const svg = await request.get(svgIcon ?? '');
  expect(svg.status()).toBe(200);
  expect(await svg.text()).toContain('#213C41');
  const ico = await request.get('/favicon.ico');
  expect(ico.status()).toBe(200);
  // ICO header: reserved 0, type 1 (icon).
  expect([...(await ico.body()).subarray(0, 4)]).toEqual([0, 0, 1, 0]);
});

// FC 004 · T1.1 Named(Tx, Al) ⟺ Tx ∨ Al and T1.2 Dec(D, H) ⟺ ¬D ∨ H, on every icon-bearing page.
for (const path of ['/', '/en/', '/nosotros/', '/no-existe/']) {
  test(`${path}: every icon is hidden decoration and every control has a name`, async ({
    page,
  }) => {
    await page.goto(path);
    const icons = page.locator('main svg, header svg, footer svg');
    expect(await icons.count()).toBeGreaterThan(0);
    for (const hidden of await icons.evaluateAll((svgs) =>
      svgs.map((svg) => svg.getAttribute('aria-hidden'))
    )) {
      expect(hidden).toBe('true');
    }
    const unnamed = await page
      .locator('a[href], button, summary')
      .evaluateAll((controls) =>
        controls
          .filter(
            (control) =>
              !control.textContent?.trim() &&
              !control.getAttribute('aria-label')?.trim()
          )
          .map((control) => control.outerHTML.slice(0, 80))
      );
    expect(unnamed).toEqual([]);
  });
}
