import { expect, test } from '@playwright/test';

test('home page renders the Protocol L landing', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Protocol L');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'NO SIGNED FC'
  );
  await expect(
    page.getByText('protocols/north-star/001_NS_ProtocolL.md')
  ).toBeVisible();
});
