import { test, expect, Route } from '@playwright/test';

/**
 * Persistent rich title-based sidebar filters (Build-5).
 *
 * Mocks the backend so the test can assert filter math deterministically.
 */

const conversations = [
  { uuid: 'a-1', name: 'MCP server bootstrap', model: 'claude', source: 'CLAUDE_CODE', is_starred: false, is_temporary: false, message_count: 4, human_message_count: 2, has_branches: false, summary: '', created_at: '2026-04-01T10:00:00Z', updated_at: '2026-04-01T10:00:00Z', project_path: '/p/explorer', project_name: 'explorer', git_branch: 'main', subagents: [] },
  { uuid: 'b-2', name: 'React refactor', model: 'claude', source: 'CLAUDE_CODE', is_starred: false, is_temporary: false, message_count: 4, human_message_count: 2, has_branches: false, summary: '', created_at: '2026-04-02T10:00:00Z', updated_at: '2026-04-02T10:00:00Z', project_path: '/p/other', project_name: 'other', git_branch: 'main', subagents: [] },
  { uuid: 'c-3', name: 'MCP test plan', model: 'claude', source: 'CLAUDE_CODE', is_starred: false, is_temporary: false, message_count: 4, human_message_count: 2, has_branches: false, summary: '', created_at: '2026-04-03T10:00:00Z', updated_at: '2026-04-03T10:00:00Z', project_path: '/p/explorer', project_name: 'explorer', git_branch: 'main', subagents: [] },
];

async function mockBackend(page: import('@playwright/test').Page) {
  await page.route('**/api/conversations**', (route: Route) => {
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(conversations) });
  });
  await page.route('**/api/config', (route) => {
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data_dir: '/tmp', conversation_count: conversations.length }),
    });
  });
}

test.describe('Sidebar filters (Build-5)', () => {
  test.beforeEach(async ({ page, context }) => {
    await mockBackend(page);
    await context.clearCookies();
  });

  test('Manage filters button opens the modal', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { localStorage.removeItem('savedFilters'); localStorage.removeItem('activeFilterIds'); });
    const manage = page.getByRole('button', { name: /manage filters/i });
    await expect(manage).toBeVisible();
    await manage.click();
    await expect(page.getByRole('dialog', { name: /manage filters/i })).toBeVisible();
  });

  test('creating an include-glob filter narrows the list and pinning persists', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { localStorage.removeItem('savedFilters'); localStorage.removeItem('activeFilterIds'); });
    await page.getByRole('button', { name: /manage filters/i }).click();
    await page.getByRole('button', { name: /add filter/i }).click();

    // Fill in the filter form fields.
    await page.getByLabel(/filter name/i).fill('MCP work');
    await page.getByLabel(/patterns/i).fill('*mcp*');
    // Polarity defaults to 'include', mode defaults to 'glob'.
    await page.getByLabel(/pin/i).check();

    // Live-preview should report 2 matches.
    await expect(page.getByText(/2 match/i)).toBeVisible();

    await page.getByRole('button', { name: /save/i }).click();

    // Modal closes; chip appears.
    await expect(page.getByRole('dialog', { name: /manage filters/i })).toHaveCount(0);
    const chip = page.locator('[data-filter-chip]');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('MCP work');

    // Sidebar list should show only MCP* conversations.
    await expect(page.getByText('MCP server bootstrap')).toBeVisible();
    await expect(page.getByText('MCP test plan')).toBeVisible();
    await expect(page.getByText('React refactor')).toHaveCount(0);

    // Pinning persists across reload.
    await page.reload();
    await expect(page.locator('[data-filter-chip]')).toBeVisible();
    await expect(page.locator('[data-filter-chip]')).toContainText('MCP work');
    await expect(page.getByText('React refactor')).toHaveCount(0);
  });

  test('toggling a chip activates/deactivates the filter', async ({ page }) => {
    // Seed a saved filter directly into localStorage.
    await page.addInitScript(() => {
      localStorage.setItem('savedFilters', JSON.stringify([{
        id: 'f-1', name: 'MCP', patterns: ['*mcp*'], polarity: 'include', mode: 'glob', target: 'title', pinned: true,
      }]));
      localStorage.setItem('activeFilterIds', JSON.stringify(['f-1']));
    });
    await page.goto('/');

    // Filter is active -> only MCP* shown.
    await expect(page.getByText('MCP server bootstrap')).toBeVisible();
    await expect(page.getByText('React refactor')).toHaveCount(0);

    // Click chip to deactivate -> all show.
    await page.locator('[data-filter-chip][data-filter-active]').click();
    await expect(page.getByText('React refactor')).toBeVisible();
  });

  test('exclude-polarity filter hides matching conversations', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('savedFilters', JSON.stringify([{
        id: 'f-2', name: 'Hide tests', patterns: ['*test*'], polarity: 'exclude', mode: 'glob', target: 'title', pinned: true,
      }]));
      localStorage.setItem('activeFilterIds', JSON.stringify(['f-2']));
    });
    await page.goto('/');
    await expect(page.getByText('MCP server bootstrap')).toBeVisible();
    await expect(page.getByText('React refactor')).toBeVisible();
    await expect(page.getByText('MCP test plan')).toHaveCount(0);
  });

  test('empty-state banner appears when filters hide everything', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('savedFilters', JSON.stringify([{
        id: 'f-3', name: 'Impossible', patterns: ['*xxxxxxxxxxx*'], polarity: 'include', mode: 'glob', target: 'title', pinned: true,
      }]));
      localStorage.setItem('activeFilterIds', JSON.stringify(['f-3']));
    });
    await page.goto('/');
    await expect(page.getByText(/hidden by/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /clear all filters/i })).toBeVisible();
  });
});
