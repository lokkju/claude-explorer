import { test, expect } from '@playwright/test';

test.describe('Conversation Browser', () => {
  test('loads and displays conversation list', async ({ page }) => {
    await page.goto('/');

    // Should show the app header
    await expect(page.getByText('Claude Exporter')).toBeVisible();

    // Should show search input
    await expect(page.getByPlaceholder('Search titles...')).toBeVisible();

    // Should load and display conversations (may have "Starred" section)
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('displays starred conversations at top', async ({ page }) => {
    await page.goto('/');

    // Wait for conversations to load
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });

    // Check if "Starred" section exists (only if there are starred conversations)
    const starredSection = page.getByText('Starred');
    if (await starredSection.isVisible()) {
      // Starred section should be above regular conversations
      const starredY = await starredSection.boundingBox();
      const firstConvButton = page.locator('button').filter({ hasText: /msgs$/ }).first();
      const firstConvY = await firstConvButton.boundingBox();

      if (starredY && firstConvY) {
        expect(starredY.y).toBeLessThan(firstConvY.y);
      }
    }
  });

  test('filters conversations with search', async ({ page }) => {
    await page.goto('/');

    // Wait for conversations to load
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });

    // Get initial count
    const initialCount = await page.locator('button').filter({ hasText: /msgs$/ }).count();

    // Search for something specific
    const searchInput = page.getByPlaceholder('Search titles...');
    await searchInput.fill('React');

    // Wait for filter to apply
    await page.waitForTimeout(500);

    // Count should be different (filtered)
    const filteredCount = await page.locator('button').filter({ hasText: /msgs$/ }).count();

    // Either filtered count is less, or no results message appears
    const noResults = page.getByText('No conversations found');
    const hasNoResults = await noResults.isVisible();

    if (!hasNoResults) {
      expect(filteredCount).toBeLessThanOrEqual(initialCount);
    }
  });

  test('selects and displays conversation detail', async ({ page }) => {
    await page.goto('/');

    // Wait for conversations to load
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });

    // Click on first conversation
    const firstConversation = page.locator('button').filter({ hasText: /msgs$/ }).first();
    const conversationName = await firstConversation.locator('span.truncate').textContent();
    await firstConversation.click();

    // Should show conversation header with title
    if (conversationName) {
      await expect(page.getByRole('heading').filter({ hasText: conversationName.trim() })).toBeVisible({
        timeout: 5000,
      });
    }

    // Should show export buttons (use exact match to avoid matching conversation titles)
    await expect(page.getByRole('button', { name: 'Markdown', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'PDF', exact: true })).toBeVisible();

    // Should show messages (either "You" or "Claude")
    const hasMessages = await page.getByText(/^(You|Claude)$/).first().isVisible();
    expect(hasMessages).toBe(true);
  });

  test('URL updates when selecting conversation', async ({ page }) => {
    await page.goto('/');

    // Wait for conversations to load
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });

    // Click on a conversation
    await page.locator('button').filter({ hasText: /msgs$/ }).first().click();

    // URL should include /conversations/uuid
    await expect(page).toHaveURL(/\/conversations\/[a-f0-9-]+/);
  });

  test('shows empty state when no conversation selected', async ({ page }) => {
    await page.goto('/');

    // Should show "Select a conversation" message
    await expect(page.getByText('Select a conversation')).toBeVisible();
  });
});

test.describe('Conversation Detail', () => {
  test('displays human and assistant messages', async ({ page }) => {
    await page.goto('/');

    // Wait and click on first conversation
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });
    await page.locator('button').filter({ hasText: /msgs$/ }).first().click();

    // Wait for conversation to load
    await page.waitForSelector('text=/^(You|Claude)$/');

    // Should have at least one message
    const messageCount = await page.getByText(/^(You|Claude)$/).count();
    expect(messageCount).toBeGreaterThan(0);
  });

  test('renders markdown in messages', async ({ page }) => {
    await page.goto('/');

    // Select a conversation
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });
    await page.locator('button').filter({ hasText: /msgs$/ }).first().click();

    // Wait for messages
    await page.waitForSelector('text=/^(You|Claude)$/');

    // Check for prose styling (markdown rendered)
    const proseElements = await page.locator('.prose').count();
    expect(proseElements).toBeGreaterThan(0);
  });

  test('tool blocks are collapsible', async ({ page }) => {
    await page.goto('/');

    // Select a conversation that might have tool blocks
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });

    // Find a conversation with tool blocks (look for one with more messages)
    const conversations = page.locator('button').filter({ hasText: /msgs$/ });
    const count = await conversations.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      await conversations.nth(i).click();
      await page.waitForTimeout(500);

      // Check if there's a tool block
      const toolBlock = page.getByText(/^Tool:/);
      if (await toolBlock.isVisible()) {
        // Click to expand
        await toolBlock.click();

        // Should show expanded content (JSON or result)
        await expect(page.locator('pre').first()).toBeVisible();
        break;
      }
    }
  });
});

test.describe('Export Functionality', () => {
  test('can export conversation as Markdown', async ({ page }) => {
    await page.goto('/');

    // Select a conversation
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });
    await page.locator('button').filter({ hasText: /msgs$/ }).first().click();

    // Wait for export button
    const markdownBtn = page.getByRole('button', { name: 'Markdown', exact: true });
    await expect(markdownBtn).toBeVisible();

    // Set up request listener for the export API
    const exportRequestPromise = page.waitForRequest((req) =>
      req.url().includes('/export/markdown')
    );

    // Click export
    await markdownBtn.click();

    // Wait for the export API to be called
    const request = await exportRequestPromise;
    expect(request.url()).toContain('/export/markdown');
  });

  test('can export conversation as PDF', async ({ page }) => {
    await page.goto('/');

    // Select a conversation
    await expect(page.locator('button').filter({ hasText: /msgs$/ }).first()).toBeVisible({
      timeout: 10000,
    });
    await page.locator('button').filter({ hasText: /msgs$/ }).first().click();

    // Wait for export button
    const pdfBtn = page.getByRole('button', { name: 'PDF', exact: true });
    await expect(pdfBtn).toBeVisible();

    // Set up request listener for the export API
    const exportRequestPromise = page.waitForRequest((req) =>
      req.url().includes('/export/pdf')
    );

    // Click export
    await pdfBtn.click();

    // Wait for the export API to be called
    const request = await exportRequestPromise;
    expect(request.url()).toContain('/export/pdf');
  });
});
