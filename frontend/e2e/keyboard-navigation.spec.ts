import { test, expect } from '@playwright/test';

test.describe('Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for conversations to load
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('Tab navigates through interactive elements', async ({ page }) => {
    // Start from body
    await page.keyboard.press('Tab');

    // Should focus on search input first (or another interactive element)
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(['INPUT', 'BUTTON', 'A']).toContain(focused);
  });

  test('Enter selects focused conversation', async ({ page }) => {
    // Click on conversation list to focus
    await page.locator('button').filter({ hasText: /msgs$/ }).first().focus();

    // Press Enter
    await page.keyboard.press('Enter');

    // URL should update to show conversation
    await expect(page).toHaveURL(/\/conversations\/[a-f0-9-]+/);
  });

  test('search input accepts text', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Search titles...');

    // Type something
    await searchInput.fill('test query');
    expect(await searchInput.inputValue()).toBe('test query');

    // Clear manually
    await searchInput.fill('');
    expect(await searchInput.inputValue()).toBe('');
  });

  test('clicking on sidebar search focuses input', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Search titles...');

    // Click on search input
    await searchInput.click();

    // Should be focused
    await expect(searchInput).toBeFocused();
  });
});

test.describe('Accessibility', () => {
  test('page has proper heading structure', async ({ page }) => {
    await page.goto('/');

    // Wait for page to load
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });

    // Select a conversation
    await page.locator('button').filter({ hasText: /msgs$/ }).first().click();

    // Wait for conversation detail
    await page.waitForSelector('text=/^(You|Claude)$/');

    // Should have at least one heading
    const headings = await page.locator('h1, h2, h3, h4, h5, h6').count();
    expect(headings).toBeGreaterThan(0);
  });

  test('interactive elements are keyboard accessible', async ({ page }) => {
    await page.goto('/');

    // Wait for page to load
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });

    // All buttons should be tabbable
    const buttons = await page.locator('button').all();
    for (const button of buttons.slice(0, 5)) {
      // Should not have tabindex="-1" (unless it's intentionally hidden)
      const tabindex = await button.getAttribute('tabindex');
      if (tabindex !== '-1') {
        // Should be focusable
        await button.focus();
        await expect(button).toBeFocused();
      }
    }
  });

  test('conversation list items have accessible names', async ({ page }) => {
    await page.goto('/');

    // Wait for conversations
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });

    // Each conversation item should have meaningful text
    const conversationItems = page.locator('button').filter({ hasText: /msgs$/ });
    const count = await conversationItems.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const text = await conversationItems.nth(i).textContent();
      expect(text?.length).toBeGreaterThan(5); // Should have meaningful content
    }
  });

  test('form inputs have associated labels or placeholders', async ({ page }) => {
    await page.goto('/');

    // Search input should have placeholder
    const searchInput = page.getByPlaceholder('Search titles...');
    await expect(searchInput).toBeVisible();

    // Placeholder serves as accessible name
    const placeholder = await searchInput.getAttribute('placeholder');
    expect(placeholder).toBeTruthy();
  });
});
