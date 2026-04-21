import { test, expect, devices } from '@playwright/test';
import { waitForConnection } from './test-utils';

// Use mobile viewport
test.use({ viewport: { width: 375, height: 667 } });

test.describe('Mobile Responsive Layout', () => {
  test('sidebar may be hidden or collapsed on mobile', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    // Wait for page to load
    await page.waitForTimeout(1000);

    // On mobile, sidebar might be hidden, collapsed, or shown differently
    // Check that the main content is visible
    const mainContent = page.getByText('Select a conversation');

    // Either the empty state is visible, or we can see conversations
    const hasEmptyState = await mainContent.isVisible();
    const hasConversations = await page.getByRole('button', { name: /\d+ msgs/ }).first().isVisible();

    expect(hasEmptyState || hasConversations).toBe(true);
  });

  test('conversation list is scrollable on mobile', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    // Wait for conversations
    await expect(page.getByRole('button', { name: /\d+ msgs/ }).first()).toBeVisible({
      timeout: 10000,
    });

    // Should be able to scroll if there are many conversations
    const conversationCount = await page.getByRole('button', { name: /\d+ msgs/ }).count();

    if (conversationCount > 5) {
      // Scroll down
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(300);

      // Page should still be functional
      expect(await page.getByRole('button', { name: /\d+ msgs/ }).first().isVisible()).toBe(true);
    }
  });

  test('conversation detail is readable on mobile', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    // Wait and select a conversation
    await expect(page.getByRole('button', { name: /\d+ msgs/ }).first()).toBeVisible({
      timeout: 10000,
    });
    await page.getByRole('button', { name: /\d+ msgs/ }).first().click();

    // On mobile, clicking may navigate to the conversation - wait for URL change
    await page.waitForURL(/\/conversations\//, { timeout: 5000 }).catch(() => {});

    // Wait a bit for content to load
    await page.waitForTimeout(1000);

    // Try to find messages or conversation content
    const hasMessages = await page.getByText(/^(You|Claude)$/).first().isVisible().catch(() => false);
    const hasProseContent = await page.locator('.prose').first().isVisible().catch(() => false);
    const hasConversationTitle = await page.locator('h1, h2').first().isVisible().catch(() => false);

    // Should have at least some conversation-related content visible
    expect(hasMessages || hasProseContent || hasConversationTitle).toBe(true);
  });

  test('export buttons are accessible on mobile', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    // Select a conversation
    await expect(page.getByRole('button', { name: /\d+ msgs/ }).first()).toBeVisible({
      timeout: 10000,
    });
    await page.getByRole('button', { name: /\d+ msgs/ }).first().click();

    // On mobile, clicking may navigate to the conversation - wait for URL change
    await page.waitForURL(/\/conversations\//, { timeout: 5000 }).catch(() => {});

    // Wait for content to load
    await page.waitForTimeout(1000);

    // Export buttons should be visible (exact match to avoid matching conversation titles)
    const markdownBtn = page.getByRole('button', { name: 'Markdown', exact: true });
    const pdfBtn = page.getByRole('button', { name: 'PDF', exact: true });

    // Either buttons are directly visible, or there's an export menu
    const hasDirectButtons = await markdownBtn.isVisible().catch(() => false) ||
                             await pdfBtn.isVisible().catch(() => false);
    const hasExportMenu = await page.getByRole('button', { name: /Export/i }).isVisible().catch(() => false);
    const hasAnyExportOption = hasDirectButtons || hasExportMenu;

    // On mobile, export might be in a menu or buttons might be stacked
    expect(hasAnyExportOption).toBe(true);
  });

  test('touch targets are adequately sized', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    // Wait for conversations
    await expect(page.getByRole('button', { name: /\d+ msgs/ }).first()).toBeVisible({
      timeout: 10000,
    });

    // Check that conversation buttons meet minimum touch target size
    // Only check conversation buttons which are the main interactive elements
    const conversationButtons = await page.getByRole('button', { name: /\d+ msgs/ }).all();

    for (const button of conversationButtons.slice(0, 5)) {
      const box = await button.boundingBox();
      if (box) {
        // Conversation buttons should be adequately sized (at least 40px tall)
        expect(box.height).toBeGreaterThanOrEqual(40);
        expect(box.width).toBeGreaterThanOrEqual(100);
      }
    }
  });
});

test.describe('Mobile Navigation', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('can navigate between list and detail on mobile', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    // Wait for conversations
    await expect(page.getByRole('button', { name: /\d+ msgs/ }).first()).toBeVisible({
      timeout: 10000,
    });

    // Select a conversation
    await page.getByRole('button', { name: /\d+ msgs/ }).first().click();

    // Should see conversation detail
    await expect(page.getByText(/^(You|Claude)$/).first()).toBeVisible();

    // Should be able to go back (either via back button or browser back)
    await page.goBack();

    // Should see list again or empty state
    await page.waitForTimeout(500);
    const hasConversations = await page.getByRole('button', { name: /\d+ msgs/ }).first().isVisible();
    const hasEmptyState = await page.getByText('Select a conversation').isVisible();

    expect(hasConversations || hasEmptyState).toBe(true);
  });
});
