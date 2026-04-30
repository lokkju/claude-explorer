import { test, expect } from '@playwright/test';
import { waitForConnection } from './test-utils';

/**
 * Build-8 #10: the conversation-toolbar Copy button should be labeled
 * "Copy as Markdown" so users can tell at a glance what format they get.
 */

test('conversation Copy button is labeled "Copy as Markdown"', async ({ page }) => {
  await page.goto('/');
  await waitForConnection(page);

  const firstConv = page.getByRole('button', { name: /\d+ msgs/ }).first();
  await firstConv.click();

  await expect(
    page.getByRole('button', { name: /Copy as Markdown/i })
  ).toBeVisible({ timeout: 10000 });
});
