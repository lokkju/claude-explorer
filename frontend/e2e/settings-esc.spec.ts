import { test, expect } from '@playwright/test';
import { waitForConnection } from './test-utils';

/**
 * Build-8 #8: pressing Escape on the Settings page navigates back.
 */

test('Escape on Settings page navigates back to previous route', async ({ page }) => {
  await page.goto('/');
  await waitForConnection(page);

  await page.goto('/settings');
  await expect(
    page.getByRole('heading', { name: /Settings/i }).first(),
  ).toBeVisible({ timeout: 5000 });

  await page.keyboard.press('Escape');

  await expect.poll(() => page.url(), { timeout: 5000 }).not.toMatch(/\/settings$/);
});
