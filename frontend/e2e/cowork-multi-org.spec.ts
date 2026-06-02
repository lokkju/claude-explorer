import { test, expect, Route, withNetRetry } from './fixtures';

/**
 * cowork-multi-org C6 frontend e2e.
 *
 * Mocked-endpoint pattern (matches redownload-conversation.spec.ts) — no
 * live backend dependency.
 *
 * Verifies:
 *   1. /api/orgs returning {authenticated: true, orgs: [Personal, Cowork]}
 *      surfaces the workspace selector in the sidebar.
 *   2. Selecting Cowork triggers a /api/conversations request with
 *      ?organization_id=<cowork_uuid>.
 *   3. The Synology metadata conversation (UUID c8f7917d-...) appears in
 *      the list when scoped to Cowork.
 *   4. /api/orgs returning {authenticated: false} hides the selector.
 *   5. /api/orgs returning a single org also hides the selector (length<2 gate).
 */

const PERSONAL = 'ae24ae66-4622-48e7-b4b3-1ab2c49f933d';
const COWORK = '0c0c170b-1234-5678-90ab-cdef00000000';
const SYNOLOGY = 'c8f7917d-2a82-4225-a220-a97efe0b1fa7';

const personalConv = {
  uuid: '11111111-2222-3333-4444-555555555555',
  name: 'Personal Conv',
  summary: '',
  model: 'claude-sonnet-4-6',
  created_at: '2026-04-01T10:00:00Z',
  updated_at: '2026-04-01T10:00:00Z',
  is_starred: false,
  message_count: 1,
  human_message_count: 1,
  has_branches: false,
  source: 'CLAUDE_AI' as const,
  project_path: null,
  project_name: null,
  git_branch: null,
  organization_id: PERSONAL,
  organization_name: 'Personal',
  subagents: [],
};

const synologyConv = {
  uuid: SYNOLOGY,
  name: 'Synology metadata explanation',
  summary: '',
  model: 'claude-sonnet-4-6',
  created_at: '2026-04-15T10:00:00Z',
  updated_at: '2026-04-15T10:00:00Z',
  is_starred: false,
  message_count: 1,
  human_message_count: 1,
  has_branches: false,
  source: 'CLAUDE_AI' as const,
  project_path: null,
  project_name: null,
  git_branch: null,
  organization_id: COWORK,
  organization_name: 'Cowork',
  subagents: [],
};

async function mockBackend(
  page: import('@playwright/test').Page,
  opts: {
    orgsResponse?: { status: number; body: object };
    conversations?: typeof personalConv[];
  } = {},
) {
  const orgsResponse = opts.orgsResponse ?? {
    status: 200,
    body: {
      authenticated: true,
      orgs: [
        { org_id: PERSONAL, name: 'Personal', is_primary: true },
        { org_id: COWORK, name: 'Cowork', is_primary: false },
      ],
    },
  };

  await page.route('**/api/config', (route: Route) => {
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data_dir: '/tmp', conversation_count: 2 }),
    });
  });

  // Per-test preferences (Vite-proxy leak defense — see compact-markers
  // and bookmarks for the rationale). 2026-06-01.
  const prefs: { data: Record<string, unknown> } = { data: {} };
  await page.route('**/api/preferences', async (route: Route) => {
    const req = route.request();
    const method = req.method();
    if (method === 'GET') {
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: prefs.data }) });
      return;
    }
    if (method === 'PATCH' || method === 'PUT') {
      const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      const patch = (body.data ?? body) as Record<string, unknown>;
      prefs.data = method === 'PUT' ? patch : { ...prefs.data, ...patch };
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: prefs.data }) });
      return;
    }
    route.fulfill({ status: 405, body: 'Method Not Allowed' });
  });

  await page.route('**/api/orgs', (route: Route) => {
    route.fulfill({
      status: orgsResponse.status,
      contentType: 'application/json',
      body: JSON.stringify(orgsResponse.body),
    });
  });

  await page.route('**/api/conversations**', (route: Route) => {
    const url = new URL(route.request().url());
    const orgFilter = url.searchParams.get('organization_id');
    let body = opts.conversations ?? [personalConv, synologyConv];
    if (orgFilter) {
      body = body.filter((c) => c.organization_id === orgFilter);
    }
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  // Bookmarks endpoint is called on initial load (BookmarkContext).
  // The api.listBookmarks expects {bookmarks: Bookmark[]} envelope —
  // returning a bare [] makes "bookmarks is not iterable" throw and
  // crashes the entire React tree (workspace selector never mounts).
  await page.route('**/api/bookmarks**', (route: Route) => {
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ bookmarks: [] }) });
  });
}


test('workspace selector renders when /api/orgs returns >= 2 orgs', async ({ page }) => {
  await mockBackend(page);
  await withNetRetry(() => page.goto('/'));

  // The workspace select should be visible (length >= 2 gate).
  await expect(page.getByTestId('workspace-select')).toBeVisible();
});


test('workspace selector hidden when authenticated: false', async ({ page }) => {
  await mockBackend(page, {
    orgsResponse: { status: 200, body: { authenticated: false, orgs: [] } },
  });
  await withNetRetry(() => page.goto('/'));

  // Selector slot reserved for layout stability; the actual <Select>
  // element with our test-id must not exist.
  await expect(page.getByTestId('workspace-select')).not.toBeVisible();
});


test('workspace selector hidden when only one org', async ({ page }) => {
  await mockBackend(page, {
    orgsResponse: {
      status: 200,
      body: {
        authenticated: true,
        orgs: [{ org_id: PERSONAL, name: 'Personal', is_primary: true }],
      },
    },
  });
  await withNetRetry(() => page.goto('/'));
  await expect(page.getByTestId('workspace-select')).not.toBeVisible();
});


test('selecting Cowork filters /api/conversations request and shows Synology conv', async ({ page }) => {
  await mockBackend(page);

  // Capture conversation requests so we can assert the org filter is sent.
  const conversationRequests: string[] = [];
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/api/conversations') && !u.includes('/tree')) {
      conversationRequests.push(u);
    }
  });

  await withNetRetry(() => page.goto('/'));

  // Both conversations are visible initially (no workspace filter).
  await expect(page.getByText('Synology metadata explanation')).toBeVisible();
  await expect(page.getByText('Personal Conv')).toBeVisible();

  // Open the workspace select and pick Cowork.
  await page.getByTestId('workspace-select').click();
  await page.getByRole('option', { name: /Cowork/ }).click();

  // After selecting Cowork: at least one /api/conversations request should
  // include organization_id=<cowork>.
  await expect.poll(
    () => conversationRequests.some((u) => u.includes(`organization_id=${COWORK}`)),
    { timeout: 2000 },
  ).toBe(true);

  // Personal conv should disappear; Synology should remain.
  await expect(page.getByText('Personal Conv')).not.toBeVisible();
  await expect(page.getByText('Synology metadata explanation')).toBeVisible();
});


test('selecting "All workspaces" clears the filter', async ({ page }) => {
  await mockBackend(page);

  const conversationRequests: string[] = [];
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/api/conversations') && !u.includes('/tree')) {
      conversationRequests.push(u);
    }
  });

  await withNetRetry(() => page.goto('/'));

  // Pick Cowork
  await page.getByTestId('workspace-select').click();
  await page.getByRole('option', { name: /Cowork/ }).click();
  await expect(page.getByText('Personal Conv')).not.toBeVisible();

  // Now switch to "All workspaces"
  await page.getByTestId('workspace-select').click();
  await page.getByRole('option', { name: 'All workspaces' }).click();

  // Both conversations should be back. The actual user-visible behavior
  // is what matters; React Query may serve from cache (no new HTTP request)
  // since the no-filter query was already loaded on initial mount.
  await expect(page.getByText('Personal Conv')).toBeVisible();
  await expect(page.getByText('Synology metadata explanation')).toBeVisible();

  // Sanity check: the initial mount issued a no-filter request, so the
  // request log must contain at least one URL without the filter.
  const noFilterCount = conversationRequests.filter(
    (u) => !u.includes('organization_id='),
  ).length;
  expect(noFilterCount).toBeGreaterThan(0);
});
