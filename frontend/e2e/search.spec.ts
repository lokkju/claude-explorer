import { test, expect } from '@playwright/test';
import { waitForConnection } from './test-utils';

test.describe('Command Palette Full-Text Search', () => {
  test('opens command palette with Cmd+K', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

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

    // SearchPanel renders the short-query hint as a single line of text
    // alongside a magnifier icon. Match the exact phrasing used by the
    // current implementation.
    await expect(page.getByText(/Type at least 2 characters/i)).toBeVisible();
  });

  test('searches message content', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    // Open command palette
    await page.keyboard.press('Meta+k');
    await expect(page.getByPlaceholder('Search messages...')).toBeVisible();

    // Search for something likely to be in messages
    const searchInput = page.getByPlaceholder('Search messages...');
    await searchInput.fill('test');

    // Wait for either result cards or the "No matches" empty state.
    const cards = page.locator('[data-result-card]');
    const empty = page.getByText(/No matches/i);
    await expect.poll(async () => (await cards.count()) > 0 || (await empty.isVisible()))
      .toBe(true);
  });

  test('navigates to conversation when result is clicked', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    // The fixture suite ships a long TLS conversation containing the
    // `NEEDLE_HANDSHAKE` token — a unique searchable string we control,
    // so this test is deterministic regardless of the contributor's
    // local data.
    await expect(page.getByText(/Phase 5 fixture: TLS handshakes/)).toBeVisible({
      timeout: 10000,
    });

    await page.keyboard.press('Meta+k');
    await expect(page.getByPlaceholder('Search messages...')).toBeVisible();
    await page.getByPlaceholder('Search messages...').fill('NEEDLE_HANDSHAKE');

    const results = page.locator('[data-result-card]');
    await expect.poll(async () => await results.count(), { timeout: 5000 }).toBeGreaterThan(0);
    await results.first().click();

    // Should navigate to a conversation URL.
    await expect(page).toHaveURL(/\/conversations\/[a-f0-9-]+/);
  });

  test('closes command palette via keyboard (Escape)', async ({ page }) => {
    await page.goto('/');

    // Open command palette.
    await page.keyboard.press('Meta+k');
    const searchAside = page.locator('aside[aria-label="Search panel"]');
    await expect(searchAside).toHaveAttribute('aria-hidden', 'false');

    // Esc closes (the SearchPanel uses CSS transform + aria-hidden, so the
    // input element stays mounted; assert via aria-hidden).
    await page.keyboard.press('Escape');
    await expect(searchAside).toHaveAttribute('aria-hidden', 'true');
  });

  test('Cmd+K toggles open and closed', async ({ page }) => {
    await page.goto('/');

    const searchAside = page.locator('aside[aria-label="Search panel"]');
    await page.keyboard.press('Meta+k');
    await expect(searchAside).toHaveAttribute('aria-hidden', 'false');
    await page.keyboard.press('Meta+k');
    await expect(searchAside).toHaveAttribute('aria-hidden', 'true');
  });

  test('shows keyboard hint in sidebar', async ({ page }) => {
    await page.goto('/');

    // Should show the Cmd+K hint
    await expect(page.getByText('to search messages')).toBeVisible();
  });
});
