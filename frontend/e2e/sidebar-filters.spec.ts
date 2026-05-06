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
  // P3f: FilterContext now reads/writes /api/preferences. Without an
  // in-memory mock these tests would (a) inherit stale prefs from earlier
  // runs and (b) write filter state back to the real preferences.json,
  // contaminating subsequent specs. Mock with a per-test, isolated store.
  await mockEmptyPreferences(page);
}

async function mockEmptyPreferences(page: import('@playwright/test').Page) {
  const data: Record<string, unknown> = {};
  await page.route('**/api/preferences', (route: Route) => {
    const req = route.request();
    if (req.method() === 'PATCH') {
      try {
        const body = JSON.parse(req.postData() ?? '{}') as { data?: Record<string, unknown> };
        Object.assign(data, body.data ?? {});
      } catch {
        /* ignore */
      }
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 1, data }) });
      return;
    }
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 1, data }) });
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

/**
 * P1.2 — sidebar title-search scope.
 *
 * The sidebar's "Search titles..." input must filter on `name` OR
 * `project_path` only. It MUST NOT match the `summary` field. User report:
 * typing "polish" matched conversations whose title did not contain
 * "polish" because `summary` was also being scanned.
 *
 * Two tests pin the contract from both sides:
 *   (a) summary-only match -> excluded
 *   (b) project_path-only match -> included
 */
test.describe('Sidebar title search scope (P1.2)', () => {
  const summaryOnlyMatch = {
    uuid: 'sum-1',
    name: 'Quarterly review draft',
    model: 'claude',
    source: 'CLAUDE_AI',
    is_starred: false,
    is_temporary: false,
    message_count: 4,
    human_message_count: 2,
    has_branches: false,
    summary: 'Notes about polish on the deck',
    created_at: '2026-04-01T10:00:00Z',
    updated_at: '2026-04-01T10:00:00Z',
    project_path: '/p/reviews',
    project_name: 'reviews',
    git_branch: 'main',
    organization_id: null,
    organization_name: null,
    subagents: [],
  };

  const projectPathMatch = {
    uuid: 'proj-1',
    name: 'Build pipeline rework',
    model: 'claude',
    source: 'CLAUDE_CODE',
    is_starred: false,
    is_temporary: false,
    message_count: 4,
    human_message_count: 2,
    has_branches: false,
    summary: 'unrelated content',
    created_at: '2026-04-02T10:00:00Z',
    updated_at: '2026-04-02T10:00:00Z',
    project_path: '/Users/me/Source/polish-app',
    project_name: 'polish-app',
    git_branch: 'main',
    organization_id: null,
    organization_name: null,
    subagents: [],
  };

  async function mockOnly(page: import('@playwright/test').Page, rows: unknown[]) {
    await page.route('**/api/conversations**', (route: Route) => {
      const url = new URL(route.request().url());
      // Skip detail and tree URLs.
      if (/\/api\/conversations\/[^/?]+(\/tree)?($|\?)/.test(url.pathname)) {
        route.fulfill({ contentType: 'application/json', body: '{}' });
        return;
      }
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows) });
    });
    await page.route('**/api/config', (route) => {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ data_dir: '/tmp', conversation_count: rows.length }),
      });
    });
    await page.route('**/api/orgs', (route) => {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true, orgs: [] }),
      });
    });
    // P3f: isolate per-test preferences (FilterContext now reads/writes server prefs).
    await mockEmptyPreferences(page);
  }

  test('summary-only match is excluded', async ({ page }) => {
    await mockOnly(page, [summaryOnlyMatch]);
    await page.goto('/');
    // Row visible before typing (sanity).
    await expect(page.getByText(summaryOnlyMatch.name)).toBeVisible();

    const searchInput = page.getByTestId('sidebar-title-search');
    await searchInput.fill('polish');

    // Title and project_path do NOT contain "polish"; only summary does.
    // The row must be hidden.
    await expect(page.getByText(summaryOnlyMatch.name)).toHaveCount(0);
  });

  test('project_path-only match is included', async ({ page }) => {
    await mockOnly(page, [projectPathMatch]);
    await page.goto('/');
    await expect(page.getByText(projectPathMatch.name)).toBeVisible();

    const searchInput = page.getByTestId('sidebar-title-search');
    await searchInput.fill('polish');

    // project_path contains "polish" -> row stays visible.
    await expect(page.getByText(projectPathMatch.name)).toBeVisible();
  });
});
