import { test, expect, Route } from '@playwright/test';

/**
 * Compact-marker UX tests (Build-7).
 *
 * Mocks the backend to avoid depending on real CC conversation data with compact
 * markers being present in the dev environment.
 */

const FAKE_UUID = '00000000-0000-0000-0000-000000000007';

const baseConv = {
  uuid: FAKE_UUID,
  name: 'Compact-Marker Fixture',
  summary: '',
  model: 'claude-sonnet-4-6',
  created_at: '2026-04-01T10:00:00Z',
  updated_at: '2026-04-01T13:00:00Z',
  is_starred: false,
  is_temporary: false,
  message_count: 4,
  human_message_count: 3,
  has_branches: false,
  source: 'CLAUDE_CODE' as const,
  project_path: '/tmp/proj',
  project_name: 'proj',
  git_branch: '',
  subagents: [],
};

const messages = [
  {
    uuid: 'm-1',
    sender: 'human' as const,
    text: 'Begin work',
    content: [{ type: 'text', text: 'Begin work' }],
    created_at: '2026-04-01T10:00:00Z',
    updated_at: '2026-04-01T10:00:00Z',
    truncated: false,
    parent_message_uuid: null,
    attachments: [],
    files: [],
  },
  {
    uuid: 'm-compact-auto',
    sender: 'human' as const,
    text: 'Auto-compact summary text',
    content: [{ type: 'text', text: 'Auto-compact summary text' }],
    created_at: '2026-04-01T11:00:00Z',
    updated_at: '2026-04-01T11:00:00Z',
    truncated: false,
    parent_message_uuid: 'm-1',
    attachments: [],
    files: [],
  },
  {
    uuid: 'm-compact-manual',
    sender: 'human' as const,
    text: 'Manual compact summary preserving build context.',
    content: [{ type: 'text', text: 'Manual compact summary preserving build context.' }],
    created_at: '2026-04-01T12:00:00Z',
    updated_at: '2026-04-01T12:00:00Z',
    truncated: false,
    parent_message_uuid: 'm-compact-auto',
    attachments: [],
    files: [],
  },
  {
    uuid: 'm-3',
    sender: 'assistant' as const,
    text: 'Continuing.',
    content: [{ type: 'text', text: 'Continuing.' }],
    created_at: '2026-04-01T13:00:00Z',
    updated_at: '2026-04-01T13:00:00Z',
    truncated: false,
    parent_message_uuid: 'm-compact-manual',
    attachments: [],
    files: [],
  },
];

const compactMarkers = [
  {
    message_uuid: 'm-compact-auto',
    summary_text: 'Auto-compact summary text',
    timestamp: '2026-04-01T11:00:00Z',
    kind: 'auto' as const,
    user_prompt: null,
  },
  {
    message_uuid: 'm-compact-manual',
    summary_text: 'Manual compact summary preserving build context.',
    timestamp: '2026-04-01T12:00:00Z',
    kind: 'manual' as const,
    user_prompt: 'preserve context for the build phase',
  },
];

async function mockBackend(page: import('@playwright/test').Page) {
  await page.route('**/api/conversations**', (route: Route) => {
    const url = route.request().url();
    if (url.includes(`/conversations/${FAKE_UUID}/tree`)) {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ uuid: FAKE_UUID, root_messages: [], active_path: [] }),
      });
      return;
    }
    if (url.includes(`/conversations/${FAKE_UUID}`)) {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ...baseConv,
          messages,
          current_leaf_message_uuid: 'm-3',
          file_path: '/tmp/proj/fake.jsonl',
          compact_markers: compactMarkers,
        }),
      });
      return;
    }
    if (url.match(/\/api\/conversations(\?|$)/)) {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([baseConv]),
      });
      return;
    }
    route.continue();
  });

  await page.route('**/api/config', (route: Route) => {
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data_dir: '/tmp', conversation_count: 1 }),
    });
  });
}

test.describe('Compact markers', () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  test('renders inline compact-marker pill for both kinds', async ({ page }) => {
    await page.goto(`/conversations/${FAKE_UUID}`);
    const markers = page.locator('[data-compact-marker]');
    await expect(markers).toHaveCount(2);
    await expect(markers.first()).toContainText(/Compacted/);
    await expect(markers.nth(1)).toContainText(/Compacted \(manual\)/);
  });

  test('manual compact shows the user prompt inline on the divider', async ({ page }) => {
    await page.goto(`/conversations/${FAKE_UUID}`);
    await expect(
      page.locator('text=preserve context for the build phase').first()
    ).toBeVisible();
  });

  test('clicking the pill toggles the summary panel', async ({ page }) => {
    await page.goto(`/conversations/${FAKE_UUID}`);
    const pill = page.locator('[data-compact-marker-pill]').first();
    await expect(pill).toBeVisible();
    await expect(page.locator('[data-compact-marker-panel]')).toHaveCount(0);
    await pill.click();
    const panel = page.locator('[data-compact-marker-panel]').first();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Summary');
  });

  test(']/[ navigate between compact markers', async ({ page }) => {
    await page.goto(`/conversations/${FAKE_UUID}`);
    await expect(page.locator('[data-compact-marker]').first()).toBeVisible();

    // Press ] - jump to first marker (no active yet -> goes to index 0).
    await page.keyboard.press(']');
    await expect(page.locator('[data-compact-marker-active]')).toHaveCount(1);
    await expect(page.locator('[data-compact-marker-active]')).toHaveAttribute(
      'data-compact-marker',
      'm-compact-auto'
    );

    // Press ] again -> next marker (manual).
    await page.keyboard.press(']');
    await expect(page.locator('[data-compact-marker-active]')).toHaveAttribute(
      'data-compact-marker',
      'm-compact-manual'
    );

    // Press [ -> back to first.
    await page.keyboard.press('[');
    await expect(page.locator('[data-compact-marker-active]')).toHaveAttribute(
      'data-compact-marker',
      'm-compact-auto'
    );
  });

  test('hide-compact-markers toggle removes markers and shows them again', async ({ page }) => {
    await page.goto(`/conversations/${FAKE_UUID}`);
    await expect(page.locator('[data-compact-marker]').first()).toBeVisible();

    const hideButton = page.getByRole('button', { name: /hide compact markers/i });
    await hideButton.click();
    await expect(page.locator('[data-compact-marker]')).toHaveCount(0);

    const showButton = page.getByRole('button', { name: /show compact markers/i });
    await showButton.click();
    await expect(page.locator('[data-compact-marker]')).toHaveCount(2);
  });

  test('no toggle shown for non-CC conversations without compact markers', async ({ page }) => {
    // Override the mock to return a Desktop conversation with no markers.
    await page.unroute('**/api/conversations**');
    await page.route('**/api/conversations**', (route) => {
      const url = route.request().url();
      if (url.includes(`/conversations/${FAKE_UUID}/tree`)) {
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ uuid: FAKE_UUID, root_messages: [], active_path: [] }),
        });
        return;
      }
      if (url.includes(`/conversations/${FAKE_UUID}`)) {
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            ...baseConv,
            source: 'CLAUDE_AI',
            messages,
            current_leaf_message_uuid: 'm-3',
            compact_markers: [],
          }),
        });
        return;
      }
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([{ ...baseConv, source: 'CLAUDE_AI' }]),
      });
    });

    await page.goto(`/conversations/${FAKE_UUID}`);
    await expect(page.locator('text=Continuing.').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /compact markers/i })).toHaveCount(0);
  });
});
