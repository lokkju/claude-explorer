import { test, expect } from '@playwright/test';
import { waitForConnection } from './test-utils';

test.describe('Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);
    // Wait for conversations to load
    await expect(page.locator('[role="button"]').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('pressing ? opens help modal', async ({ page }) => {
    // Click on the main content area first to ensure focus (not in an input)
    await page.locator('main').click();
    // Type ? character directly using keyboard.type
    await page.keyboard.type('?');

    // Help modal should be visible
    await expect(page.locator('text=Keyboard Shortcuts')).toBeVisible({ timeout: 5000 });
  });

  test('help modal shows current keyboard mode', async ({ page }) => {
    await page.locator('main').click();
    await page.keyboard.type('?');

    // Should show Emacs mode by default
    await expect(page.locator('text=Emacs Mode')).toBeVisible();
  });

  test('help modal can be closed', async ({ page }) => {
    await page.locator('main').click();
    await page.keyboard.type('?');
    await expect(page.locator('text=Keyboard Shortcuts')).toBeVisible();

    // Click close button
    await page.click('button:has-text("Close")');

    // Modal should be gone
    await expect(page.locator('text=Keyboard Shortcuts')).not.toBeVisible();
  });

  test('help modal links to settings', async ({ page }) => {
    await page.locator('main').click();
    await page.keyboard.type('?');

    // Click the settings link
    await page.click('a:has-text("Change keyboard mode")');

    // Should navigate to settings
    await expect(page).toHaveURL(/\/settings/);
  });

  test('Tab navigates through interactive elements', async ({ page }) => {
    // Start from body
    await page.keyboard.press('Tab');

    // Should focus on search input first (or another interactive element)
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(['INPUT', 'BUTTON', 'A']).toContain(focused);
  });

  test('keyboard does not trigger in input fields', async ({ page }) => {
    // Focus the search input
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.focus();

    // Type '?' - should go into input, not open help modal
    await page.keyboard.type('?');

    // Input should contain '?'
    await expect(searchInput).toHaveValue('?');

    // Help modal should NOT be visible
    await expect(page.locator('text=Keyboard Shortcuts')).not.toBeVisible();
  });

  test('Enter selects focused conversation', async ({ page }) => {
    // Click on conversation list to focus
    await page.getByRole('button', { name: /\d+ msgs/ }).first().focus();

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

test.describe('Vim Mode', () => {
  test.beforeEach(async ({ page }) => {
    // Switch to Vim mode
    await page.goto('/settings');
    // Wait for the Vim label to be visible before clicking
    const vimLabel = page.locator('label:has-text("Vim")');
    await expect(vimLabel).toBeVisible({ timeout: 10000 });
    await vimLabel.click();
    // Wait for setting to be saved in localStorage
    await page.waitForTimeout(500);
    await page.goto('/');
    await waitForConnection(page);
  });

  test('help modal shows Vim shortcuts', async ({ page }) => {
    // Press ? to open help modal (Shift+/ on US keyboard)
    await page.locator('main').click();
    await page.keyboard.type('?');

    // Should show the help modal with Vim mode
    await expect(page.locator('text=Keyboard Shortcuts')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Vim Mode')).toBeVisible();
    // Should show vim-specific keys (use exact match to avoid matching ⌘+K)
    await expect(page.getByText('j', { exact: true })).toBeVisible();
    await expect(page.getByText('k', { exact: true })).toBeVisible();
  });

  test('/ focuses search', async ({ page }) => {
    await page.keyboard.press('/');

    // Search input should be focused
    const searchInput = page.locator('input[placeholder*="Search"]');
    await expect(searchInput).toBeFocused();
  });
});

test.describe('Emacs Mode', () => {
  test.beforeEach(async ({ page }) => {
    // Ensure Emacs mode is selected
    await page.goto('/settings');
    await waitForConnection(page, { waitForConversations: false });
    await page.click('label:has-text("Emacs")');
    // Wait for setting to be saved
    await page.waitForTimeout(500);
    await page.goto('/');
    await waitForConnection(page);
  });

  test('help modal shows Emacs shortcuts', async ({ page }) => {
    // Press ? to open help modal (Shift+/ on US keyboard)
    await page.locator('main').click();
    await page.keyboard.type('?');

    // Should show the help modal with Emacs mode
    await expect(page.locator('text=Keyboard Shortcuts')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Emacs Mode')).toBeVisible();
    // Should show emacs-specific keys (use first() since multiple Ctrl keys exist)
    await expect(page.getByText('Ctrl').first()).toBeVisible();
  });

  test('Ctrl+S focuses search', async ({ page }) => {
    await page.keyboard.press('Control+s');

    // Search input should be focused
    const searchInput = page.locator('input[placeholder*="Search"]');
    await expect(searchInput).toBeFocused();
  });
});

test.describe('Accessibility', () => {
  test('page has proper heading structure', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    // Wait for page to load
    await expect(page.getByRole('button', { name: /\d+ msgs/ }).first()).toBeVisible({
      timeout: 10000,
    });

    // Select a conversation
    await page.getByRole('button', { name: /\d+ msgs/ }).first().click();

    // Wait for conversation detail
    await page.waitForSelector('text=/^(You|Claude)$/');

    // Should have at least one heading
    const headings = await page.locator('h1, h2, h3, h4, h5, h6').count();
    expect(headings).toBeGreaterThan(0);
  });

  test('interactive elements are keyboard accessible', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    // Wait for page to load
    await expect(page.getByRole('button', { name: /\d+ msgs/ }).first()).toBeVisible({
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
    await waitForConnection(page);

    // Wait for conversations
    await expect(page.getByRole('button', { name: /\d+ msgs/ }).first()).toBeVisible({
      timeout: 10000,
    });

    // Each conversation item should have meaningful text
    const conversationItems = page.getByRole('button', { name: /\d+ msgs/ });
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

  // B9 — Cmd+R (or Ctrl+R) is intercepted: it triggers a React Query
  // invalidation of the conversation list rather than a full browser
  // reload. The article calls this out (line 135) because losing the
  // single-page state on every refresh is the classic SPA gotcha.
  test('Cmd+R invalidates the conversation list query without a browser reload (B9)', async ({ page }) => {
    let listRequestCount = 0
    await page.route('**/api/conversations*', (route) => {
      const url = new URL(route.request().url())
      if (!/\/api\/conversations\/[^/?]+/.test(url.pathname)) {
        listRequestCount += 1
      }
      route.fulfill({ contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    await expect.poll(() => listRequestCount).toBeGreaterThan(0)

    // Tag the window so we can detect a true browser reload (which would
    // wipe this property).
    await page.evaluate(() => {
      ;(window as unknown as { __noReloadSentinel: boolean }).__noReloadSentinel = true
    })

    const before = listRequestCount
    await page.locator('main').click()
    // Use Meta+R on macOS-style keyboards; Playwright accepts the alias.
    await page.keyboard.press('Meta+r')

    // List re-fetched (query invalidation).
    await expect.poll(() => listRequestCount).toBeGreaterThan(before)
    // Sentinel survived → no browser reload.
    const sentinel = await page.evaluate(() => {
      return (window as unknown as { __noReloadSentinel?: boolean }).__noReloadSentinel === true
    })
    expect(sentinel).toBe(true)
  });
});
