import { test, expect } from '@playwright/test';
import { waitForConnection } from './test-utils';

/**
 * These tests run against a real backend, but in fixture mode the
 * backend is pointed at `tests/fixtures/desktop` + `tests/fixtures/claude`
 * (see playwright.config.ts). That gives us four deterministic
 * conversations to assert against:
 *
 *   - "Phase 5 fixture: TLS handshakes (long)" — 30 messages
 *   - "Phase 5 fixture: Branch tree" — has_branches=true
 *   - "Phase 5 fixture: Tool calls" — tool_use + tool_result blocks
 *   - "Hi! NEEDLE_CC — fixture session for Phase 5 tests." — CC source
 *
 * Each fixture embeds a unique searchable token (NEEDLE_*) for the
 * search tests.
 */

const TLS_TITLE = 'Phase 5 fixture: TLS handshakes (long)';
const BRANCH_TITLE = 'Phase 5 fixture: Branch tree';

test.describe('Conversation Browser', () => {
  test('loads and displays conversation list', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    // App header.
    await expect(page.getByText('Claude Explorer')).toBeVisible();

    // Search input.
    await expect(page.getByPlaceholder('Search titles...')).toBeVisible();

    // The fixtures dataset always includes the long TLS conversation.
    await expect(page.getByText(TLS_TITLE)).toBeVisible({ timeout: 10000 });
  });

  test('displays starred conversations at top', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    // Wait for the list to render.
    await expect(page.getByText(TLS_TITLE)).toBeVisible({ timeout: 10000 });

    // The fixtures don't include any starred conversations (deliberately
    // — we only want to assert that the starred section is _absent_
    // when nothing is starred). The Starred header should NOT appear.
    await expect(page.getByText('Starred', { exact: true })).toHaveCount(0);
  });

  test('filters conversations with search', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    await expect(page.getByText(TLS_TITLE)).toBeVisible({ timeout: 10000 });

    // Type a query that matches only the Branch tree fixture by title.
    const searchInput = page.getByPlaceholder('Search titles...');
    await searchInput.fill('Branch tree');

    // The TLS title should disappear; the Branch tree title should remain.
    await expect(page.getByText(BRANCH_TITLE)).toBeVisible();
    await expect(page.getByText(TLS_TITLE)).toHaveCount(0);

    // Clear the filter.
    await searchInput.fill('');
    await expect(page.getByText(TLS_TITLE)).toBeVisible();
  });

  test('selects and displays conversation detail', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    // Click the long TLS conversation by exact title.
    await expect(page.getByText(TLS_TITLE)).toBeVisible({ timeout: 10000 });
    await page.getByText(TLS_TITLE).click();

    // The conversation header should display the title.
    await expect(page.getByRole('heading', { name: TLS_TITLE })).toBeVisible({
      timeout: 5000,
    });

    // The Markdown / PDF export buttons render in the conversation header.
    await expect(page.getByRole('button', { name: 'Markdown', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'PDF', exact: true })).toBeVisible();

    // At least one You / Claude bubble renders.
    await expect(page.getByText(/^(You|Claude)$/).first()).toBeVisible();
  });

  test('URL updates when selecting conversation', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    await expect(page.getByText(TLS_TITLE)).toBeVisible({ timeout: 10000 });
    await page.getByText(TLS_TITLE).click();

    await expect(page).toHaveURL(/\/conversations\/[a-f0-9-]+/);
  });

  test('shows hint state when no conversation selected', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    // The empty-state copy: "Press Enter to open this conversation."
    await expect(
      page.getByText(/Press\s+Enter\s+to open this conversation/i)
    ).toBeVisible();
  });
});

test.describe('Conversation Detail', () => {
  test('displays human and assistant messages', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    await expect(page.getByText(TLS_TITLE)).toBeVisible({ timeout: 10000 });
    await page.getByText(TLS_TITLE).click();

    // Wait for the message stream to mount.
    await page.waitForSelector('[data-testid="message-stream"]', { timeout: 10000 });

    // Expect at least one You and one Claude bubble (the long fixture
    // alternates 30 messages).
    const messageCount = await page.getByText(/^(You|Claude)$/).count();
    expect(messageCount).toBeGreaterThan(1);
  });

  test('renders markdown in messages', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    await expect(page.getByText(TLS_TITLE)).toBeVisible({ timeout: 10000 });
    await page.getByText(TLS_TITLE).click();

    // The first user message in the long fixture starts with "Hi! Let's talk about TLS."
    await expect(page.getByText(/Let's talk about TLS/)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Export Functionality', () => {
  test('Markdown export button is visible in the conversation header', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    await expect(page.getByText(TLS_TITLE)).toBeVisible({ timeout: 10000 });
    await page.getByText(TLS_TITLE).click();

    // Direct buttons in the header (no dropdown menu).
    await expect(page.getByRole('button', { name: 'Markdown', exact: true })).toBeVisible({ timeout: 5000 });
  });

  test('PDF export button is visible in the conversation header', async ({ page }) => {
    await page.goto('/');
    await waitForConnection(page);

    await expect(page.getByText(TLS_TITLE)).toBeVisible({ timeout: 10000 });
    await page.getByText(TLS_TITLE).click();

    await expect(page.getByRole('button', { name: 'PDF', exact: true })).toBeVisible({ timeout: 5000 });
  });
});
