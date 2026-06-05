import { test, expect, withNetRetry } from './fixtures'

/**
 * Build-8 #8: pressing Escape on the Settings page navigates back.
 */

test('Escape on Settings page navigates back to previous route', async ({ page, mockBackend }) => {
  await mockBackend();
  await withNetRetry(page, () => page.goto('/'));

  await withNetRetry(page, () => page.goto('/settings'));
  await expect(
    page.getByRole('heading', { name: /Settings/i }).first(),
  ).toBeVisible({ timeout: 5000 });

  await page.keyboard.press('Escape');

  await expect.poll(() => page.url(), { timeout: 5000 }).not.toMatch(/\/settings$/);
});
