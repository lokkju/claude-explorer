import { test, expect, Route } from '@playwright/test';

/**
 * Build-9 Bug 3 (frontend): the per-conversation "Re-download this
 * conversation" button (renamed from "Force re-fetch") must:
 *
 *   1. Be labelled clearly so the user can distinguish it from the
 *      sidebar's whole-list Refresh button.
 *   2. Surface the backend's friendly `detail` text in the toast (not raw
 *      JSON or generic 5xx text).
 *   3. Stay disabled / hidden for Claude Code conversations (those live
 *      in local JSONL files and have no upstream to re-fetch).
 */

const FAKE_UUID = '00000000-0000-0000-0000-0000000000fe';

const baseConv = {
  uuid: FAKE_UUID,
  name: 'Synology metadata explanation',
  summary: '',
  model: 'claude-sonnet-4-6',
  created_at: '2026-04-01T10:00:00Z',
  updated_at: '2026-04-01T10:00:00Z',
  is_starred: false,
  is_temporary: false,
  message_count: 1,
  human_message_count: 1,
  has_branches: false,
  source: 'CLAUDE_AI' as const,
  project_path: null,
  project_name: null,
  git_branch: null,
  subagents: [],
};

async function mockBackend(
  page: import('@playwright/test').Page,
  refetchResponse: { status: number; body: object },
) {
  await page.route('**/api/config', (route: Route) => {
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data_dir: '/tmp', conversation_count: 1 }) });
  });

  await page.route('**/api/fetch/conversation/**', (route: Route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: refetchResponse.status,
        contentType: 'application/json',
        body: JSON.stringify(refetchResponse.body),
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
            {
              uuid: 'm-1',
              sender: 'human',
              text: 'Hi',
              content: [{ type: 'text', text: 'Hi' }],
              created_at: baseConv.created_at,
              updated_at: baseConv.created_at,
              truncated: false,
              parent_message_uuid: null,
              attachments: [],
              files: [],
            },
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

test.describe('Re-download this conversation (Bug 3)', () => {
  test('button is renamed to "Re-download this conversation"', async ({ page }) => {
    await mockBackend(page, {
      status: 200,
      body: { uuid: FAKE_UUID, status: 'refetched', name: baseConv.name },
    });

    await page.goto(`/conversations/${FAKE_UUID}`);

    // The renamed button MUST be visible.
    const button = page.getByRole('button', { name: /re-download this conversation/i });
    await expect(button).toBeVisible();
  });

  test('on success, shows friendly success toast', async ({ page }) => {
    await mockBackend(page, {
      status: 200,
      body: { uuid: FAKE_UUID, status: 'refetched', name: baseConv.name },
    });

    await page.goto(`/conversations/${FAKE_UUID}`);
    await page.getByRole('button', { name: /re-download this conversation/i }).click();

    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText(/re-downloaded|re-fetched|complete/i);
  });

  test('on 404, shows the backend\'s friendly detail (not raw JSON)', async ({ page }) => {
    const friendly =
      "This conversation isn't available on Anthropic anymore. It may have been deleted or archived.";
    await mockBackend(page, {
      status: 404,
      body: { detail: friendly },
    });

    await page.goto(`/conversations/${FAKE_UUID}`);
    await page.getByRole('button', { name: /re-download this conversation/i }).click();

    const toast = page.locator('[data-sonner-toast][data-type="error"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    // Friendly message verbatim, not "Re-fetch failed: {\"detail\":\"...\"}" JSON.
    await expect(toast).toContainText(/isn't available on Anthropic/);
    await expect(toast).not.toContainText(/\{"detail"/);
  });

  test('on cross-workspace 404, shows the workspace explanation', async ({ page }) => {
    const friendly =
      'This conversation may belong to a different Anthropic workspace than your current login. Cross-workspace sync is coming in a future update.';
    await mockBackend(page, {
      status: 404,
      body: { detail: friendly },
    });

    await page.goto(`/conversations/${FAKE_UUID}`);
    await page.getByRole('button', { name: /re-download this conversation/i }).click();

    const toast = page.locator('[data-sonner-toast][data-type="error"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText(/different Anthropic workspace/);
  });

  test('on 401 (session expired), shows the session-expired copy', async ({ page }) => {
    const sessionExpired =
      'Session expired or Cloudflare-blocked. Re-run claude-explorer capture to refresh credentials.';
    await mockBackend(page, {
      status: 401,
      body: { detail: sessionExpired },
    });

    await page.goto(`/conversations/${FAKE_UUID}`);
    await page.getByRole('button', { name: /re-download this conversation/i }).click();

    const toast = page.locator('[data-sonner-toast][data-type="error"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText(/session expired|re-run|re-capture/i);
  });
});
