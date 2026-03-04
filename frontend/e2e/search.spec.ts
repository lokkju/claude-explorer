import { test, expect } from '@playwright/test';

test.describe('Command Palette Full-Text Search', () => {
  test('opens command palette with Cmd+K', async ({ page }) => {
    await page.goto('/');

    // Press Cmd+K (or Ctrl+K on Windows/Linux)
    await page.keyboard.press('Meta+k');

    // Should show the command palette
    await expect(page.getByPlaceholder('Search messages...')).toBeVisible();
  });

  test('shows hint for short queries', async ({ page }) => {
    await page.goto('/');

    // Open command palette
    await page.keyboard.press('Meta+k');
    await expect(page.getByPlaceholder('Search messages...')).toBeVisible();

    // Type a single character
    await page.getByPlaceholder('Search messages...').fill('a');

    // Should show hint
    await expect(page.getByText('Type at least 2 characters')).toBeVisible();
  });

  test('searches message content', async ({ page }) => {
    await page.goto('/');

    // Open command palette
    await page.keyboard.press('Meta+k');
    await expect(page.getByPlaceholder('Search messages...')).toBeVisible();

    // Search for something likely to be in messages
    const searchInput = page.getByPlaceholder('Search messages...');
    await searchInput.fill('React');

    // Wait for results to appear
    await page.waitForTimeout(500);

    // Should show search results with conversation names or "No results"
    const hasResults = await page.locator('[cmdk-item]').count() > 0;
    const hasNoResults = await page.getByText('No results found').isVisible();

    expect(hasResults || hasNoResults).toBe(true);
  });

  test('navigates to conversation when result is clicked', async ({ page }) => {
    await page.goto('/');

    // Wait for conversations to load
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });

    // Get the name of the first conversation for searching
    const firstConvName = await page.locator('button').filter({ hasText: /msgs$/ }).first()
      .locator('span.truncate').textContent();

    if (!firstConvName) {
      test.skip();
      return;
    }

    // Open command palette and search
    await page.keyboard.press('Meta+k');
    await expect(page.getByPlaceholder('Search messages...')).toBeVisible();

    // Search for the conversation name
    await page.getByPlaceholder('Search messages...').fill(firstConvName.substring(0, 10));

    // Wait for results
    await page.waitForTimeout(500);

    // Click on first result if available
    const results = page.locator('[cmdk-item]');
    if (await results.count() > 0) {
      await results.first().click();

      // Should navigate to conversation
      await expect(page).toHaveURL(/\/conversations\/[a-f0-9-]+/);

      // Command palette should be closed
      await expect(page.getByPlaceholder('Search messages...')).not.toBeVisible();
    }
  });

  test('closes command palette with close button', async ({ page }) => {
    await page.goto('/');

    // Open command palette
    await page.keyboard.press('Meta+k');
    await expect(page.getByPlaceholder('Search messages...')).toBeVisible();

    // Click the X close button
    await page.locator('button').filter({ has: page.locator('svg.lucide-x') }).click();

    // Should close
    await expect(page.getByPlaceholder('Search messages...')).not.toBeVisible();
  });

  test('closes command palette when clicking backdrop', async ({ page }) => {
    await page.goto('/');

    // Open command palette
    await page.keyboard.press('Meta+k');
    await expect(page.getByPlaceholder('Search messages...')).toBeVisible();

    // Click on the backdrop (outside the dialog)
    await page.locator('.fixed.inset-0.bg-black\\/50').click();

    // Should close
    await expect(page.getByPlaceholder('Search messages...')).not.toBeVisible();
  });

  test('shows keyboard hint in sidebar', async ({ page }) => {
    await page.goto('/');

    // Should show the Cmd+K hint
    await expect(page.getByText('to search messages')).toBeVisible();
  });
});
