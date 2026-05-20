import { test, expect, Route } from '@playwright/test';

/**
 * Per-conversation force-refetch action (Build-1 follow-up).
 *
 * The "Force re-fetch" button in the conversation header invokes
 * POST /api/fetch/conversation/<uuid>. Mocks both the conversation list and
 * the fetch endpoint to keep the test deterministic.
 */

const FAKE_UUID = '00000000-0000-0000-0000-0000000000fe';

const baseConv = {
  uuid: FAKE_UUID,
  name: 'Refetch fixture',
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
  subagents: [],
};

async function mockBackend(page: import('@playwright/test').Page, calls: { count: number }) {
  await page.route('**/api/config', (route: Route) => {
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data_dir: '/tmp', conversation_count: 1 }) });
  });

  await page.route('**/api/fetch/conversation/**', (route: Route) => {
    if (route.request().method() === 'POST') {
      calls.count += 1;
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ uuid: FAKE_UUID, status: 'refetched', name: 'Refetch fixture (refreshed)' }),
      });
      return;
    }
    route.continue();
  });

  await page.route('**/api/conversations**', (route: Route) => {
    const url = route.request().url();
    if (url.includes(`/${FAKE_UUID}/tree`)) {
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ uuid: FAKE_UUID, root_messages: [], active_path: [] }) });
      return;
    }
    if (url.includes(`/${FAKE_UUID}`)) {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ...baseConv,
          messages: [
            { uuid: 'm-1', sender: 'human', text: 'Hi', content: [{ type: 'text', text: 'Hi' }], created_at: baseConv.created_at, updated_at: baseConv.created_at, truncated: false, parent_message_uuid: null, attachments: [], files: [] },
          ],
          current_leaf_message_uuid: 'm-1',
          file_path: '/tmp/x',
          compact_markers: [],
        }),
      });
      return;
    }
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([baseConv]) });
  });
}

test.describe('Force re-fetch', () => {
  test('Force re-fetch button posts to /api/fetch/conversation/<uuid>', async ({ page }) => {
    const calls = { count: 0 };
    await mockBackend(page, calls);

    await page.goto(`/conversations/${FAKE_UUID}`);

    // The button was renamed to "Re-download this conversation" and later
    // demoted to an icon-only ghost (aria-label preserved).
    const button = page.getByRole('button', { name: /re-download this conversation/i });
    await expect(button).toBeVisible();
    await button.click();

    await expect.poll(() => calls.count, { timeout: 5_000 }).toBeGreaterThan(0);
  });
});
