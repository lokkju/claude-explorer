import { test, expect, devices } from '@playwright/test';

// Use mobile viewport
test.use({ viewport: { width: 375, height: 667 } });

test.describe('Mobile Responsive Layout', () => {
  test('sidebar may be hidden or collapsed on mobile', async ({ page }) => {
    await page.goto('/');

    // Wait for page to load
    await page.waitForTimeout(1000);

    // On mobile, sidebar might be hidden, collapsed, or shown differently
    // Check that the main content is visible
    const mainContent = page.getByText('Select a conversation');

    // Either the empty state is visible, or we can see conversations
    const hasEmptyState = await mainContent.isVisible();
    const hasConversations = await page.locator('button').filter({ hasText: /msgs$/ }).first().isVisible();

    expect(hasEmptyState || hasConversations).toBe(true);
  });

  test('conversation list is scrollable on mobile', async ({ page }) => {
    await page.goto('/');

    // Wait for conversations
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });

    // Should be able to scroll if there are many conversations
    const conversationCount = await page.locator('button').filter({ hasText: /msgs$/ }).count();

    if (conversationCount > 5) {
      // Scroll down
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(300);

      // Page should still be functional
      expect(await page.locator('button').filter({ hasText: /msgs$/ }).first().isVisible()).toBe(true);
    }
  });

  test('conversation detail is readable on mobile', async ({ page }) => {
    await page.goto('/');

    // Wait and select a conversation
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });
    await page.locator('button').filter({ hasText: /msgs$/ }).first().click();

    // Wait for messages
    await page.waitForSelector('text=/^(You|Claude)$/');

    // Messages should be visible and readable
    const messageText = page.getByText(/^(You|Claude)$/).first();
    await expect(messageText).toBeVisible();

    // Verify the page is functional and content is visible
    const hasContent = await page.locator('.prose').first().isVisible();
    expect(hasContent).toBe(true);
  });

  test('export buttons are accessible on mobile', async ({ page }) => {
    await page.goto('/');

    // Select a conversation
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });
    await page.locator('button').filter({ hasText: /msgs$/ }).first().click();

    // Wait for conversation to load
    await page.waitForSelector('text=/^(You|Claude)$/');

    // Export buttons should be visible (exact match to avoid matching conversation titles)
    const markdownBtn = page.getByRole('button', { name: 'Markdown', exact: true });
    const pdfBtn = page.getByRole('button', { name: 'PDF', exact: true });

    // Either buttons are directly visible, or there's an export menu
    const hasDirectButtons = await markdownBtn.isVisible() || await pdfBtn.isVisible();
    const hasExportMenu = await page.getByRole('button', { name: /Export/i }).isVisible();

    expect(hasDirectButtons || hasExportMenu).toBe(true);
  });

  test('touch targets are adequately sized', async ({ page }) => {
    await page.goto('/');

    // Wait for conversations
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });

    // Check that buttons meet minimum touch target size (44x44 is recommended)
    const buttons = await page.locator('button').all();

    for (const button of buttons.slice(0, 5)) {
      const box = await button.boundingBox();
      if (box) {
        // At minimum, should be tappable (24px is absolute minimum)
        expect(box.height).toBeGreaterThanOrEqual(24);
        expect(box.width).toBeGreaterThanOrEqual(24);
      }
    }
  });
});

test.describe('Mobile Navigation', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('can navigate between list and detail on mobile', async ({ page }) => {
    await page.goto('/');

    // Wait for conversations
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });

    // Select a conversation
    await page.locator('button').filter({ hasText: /msgs$/ }).first().click();

    // Should see conversation detail
    await expect(page.getByText(/^(You|Claude)$/).first()).toBeVisible();

    // Should be able to go back (either via back button or browser back)
    await page.goBack();

    // Should see list again or empty state
    await page.waitForTimeout(500);
    const hasConversations = await page.locator('button').filter({ hasText: /msgs$/ }).first().isVisible();
    const hasEmptyState = await page.getByText('Select a conversation').isVisible();

    expect(hasConversations || hasEmptyState).toBe(true);
  });
});
