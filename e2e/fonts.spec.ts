import { expect, test } from '@playwright/test';

// FC 035 (259_AN): Inter is served by the site itself. Neither the build nor the browser calls
// Google, and the basic Latin file stays preloaded as it was with next/font/google.

test('pages load Inter from the site itself and never call Google Fonts', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  for (const path of ['/', '/en/', '/catalogo/']) {
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
  }
  expect(
    requests.filter((url) => /fonts\.(googleapis|gstatic)\.com/.test(url))
  ).toEqual([]);
  expect(
    requests.some((url) => /\/_next\/static\/media\/[\w.-]+\.woff2$/.test(url))
  ).toBe(true);
});

test('the home page preloads the basic Latin Inter file', async ({ page }) => {
  // Next writes font preloads from a manifest it only fills when building on Linux (its loader
  // path check uses "/"); the CI builds there, a Windows workstation build has none.
  test.skip(
    process.platform === 'win32',
    'built on Windows: Next omits the preload'
  );
  await page.goto('/');
  await expect(
    page.locator('link[rel="preload"][as="font"][type="font/woff2"]')
  ).toHaveAttribute('href', /^\/_next\/static\/media\/[\w-]+\.p\.woff2$/);
});
