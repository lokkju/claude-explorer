import { test, expect, Route } from '@playwright/test';

/**
 * Message bookmarks (Build-4).
 *
 * Mocks both the conversations endpoint and the bookmarks endpoint with an
 * in-memory state. Tests cover: hover-revealed star, b-key toggle, deep-link
 * round-trip, Markdown export, and persistence.
 */

const FAKE_UUID = '00000000-0000-0000-0000-0000000000bb';

const baseConv = {
  uuid: FAKE_UUID,
  name: 'Bookmarks fixture',
  summary: '',
  model: 'claude-sonnet-4-6',
  created_at: '2026-04-01T10:00:00Z',
  updated_at: '2026-04-01T13:00:00Z',
  is_starred: false,
  is_temporary: false,
  message_count: 3,
  human_message_count: 2,
  has_branches: false,
  source: 'CLAUDE_CODE' as const,
  project_path: '/tmp/proj',
  project_name: 'proj',
  git_branch: '',
  subagents: [],
};

const messages = [
  {
    uuid: 'msg-A',
    sender: 'human' as const,
    text: 'First user prompt',
    content: [{ type: 'text', text: 'First user prompt' }],
    created_at: '2026-04-01T10:00:00Z',
    updated_at: '2026-04-01T10:00:00Z',
    truncated: false,
    parent_message_uuid: null,
    attachments: [],
    files: [],
  },
  {
    uuid: 'msg-B',
    sender: 'assistant' as const,
    text: 'Assistant reply with bookmark target text',
    content: [{ type: 'text', text: 'Assistant reply with bookmark target text' }],
    created_at: '2026-04-01T10:01:00Z',
    updated_at: '2026-04-01T10:01:00Z',
    truncated: false,
    parent_message_uuid: 'msg-A',
    attachments: [],
    files: [],
  },
  {
    uuid: 'msg-C',
    sender: 'human' as const,
    text: 'Follow-up message',
    content: [{ type: 'text', text: 'Follow-up message' }],
    created_at: '2026-04-01T10:02:00Z',
    updated_at: '2026-04-01T10:02:00Z',
    truncated: false,
    parent_message_uuid: 'msg-B',
    attachments: [],
    files: [],
  },
];

interface MockBookmark {
  id: string;
  conversation_id: string;
  message_uuid: string;
  source: 'claude_code' | 'claude_desktop';
  created_at: string;
  note: string;
  snippet: string;
}

async function mockBackend(page: import('@playwright/test').Page) {
  const state: { bookmarks: MockBookmark[] } = { bookmarks: [] };

  await page.route('**/api/config', (route: Route) => {
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data_dir: '/tmp', conversation_count: 1 }),
    });
  });

  await page.route('**/api/bookmarks**', async (route: Route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const idMatch = url.match(/\/api\/bookmarks\/([^/?]+)/);
    if (method === 'GET') {
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ bookmarks: state.bookmarks }) });
      return;
    }
    if (method === 'POST') {
      const body = req.postDataJSON() as Partial<MockBookmark>;
      const newBm: MockBookmark = {
        id: `bm-${Math.random().toString(36).slice(2, 8)}`,
        conversation_id: body.conversation_id ?? '',
        message_uuid: body.message_uuid ?? '',
        source: (body.source as MockBookmark['source']) ?? 'claude_code',
        created_at: new Date().toISOString(),
        note: body.note ?? '',
        snippet: (body.snippet ?? '').slice(0, 140),
      };
      state.bookmarks.push(newBm);
      route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(newBm) });
      return;
    }
    if (method === 'PATCH' && idMatch) {
      const id = idMatch[1];
      const body = req.postDataJSON() as Partial<MockBookmark>;
      const bm = state.bookmarks.find((b) => b.id === id);
      if (!bm) {
        route.fulfill({ status: 404, body: 'Not found' });
        return;
      }
      if (body.note !== undefined) bm.note = body.note;
      if (body.snippet !== undefined) bm.snippet = body.snippet;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bm) });
      return;
    }
    if (method === 'DELETE' && idMatch) {
      const id = idMatch[1];
      const before = state.bookmarks.length;
      state.bookmarks = state.bookmarks.filter((b) => b.id !== id);
      if (state.bookmarks.length === before) {
        route.fulfill({ status: 404, body: 'Not found' });
      } else {
        route.fulfill({ status: 204, body: '' });
      }
      return;
    }
    route.continue();
  });

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
          current_leaf_message_uuid: 'msg-C',
          file_path: '/tmp/proj/fake.jsonl',
          compact_markers: [],
        }),
      });
      return;
    }
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([baseConv]) });
  });
}

test.describe('Message bookmarks (Build-4)', () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  test('right pane has Search and Bookmarks tabs', async ({ page }) => {
    await page.goto(`/conversations/${FAKE_UUID}`);
    // Open the right panel (Cmd/Ctrl+K).
    const isMac = (await page.evaluate(() => navigator.platform.includes('Mac')));
    await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');

    await expect(page.getByRole('tab', { name: /search/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /bookmarks/i })).toBeVisible();
  });

  test('hover-revealed star creates a bookmark; another click removes it', async ({ page }) => {
    await page.goto(`/conversations/${FAKE_UUID}`);
    const bubble = page.locator('[data-message-uuid="msg-B"]');
    await bubble.hover();

    const star = bubble.getByRole('button', { name: /bookmark/i });
    await expect(star).toBeVisible();
    await star.click();

    // After bookmarking, star should reflect filled state via aria.
    await expect(bubble.locator('[data-bookmarked]')).toHaveCount(1);

    // Click again to remove.
    await bubble.hover();
    await bubble.getByRole('button', { name: /bookmark/i }).click();
    await expect(bubble.locator('[data-bookmarked]')).toHaveCount(0);
  });

  test('pressing b on a focused message toggles its bookmark', async ({ page }) => {
    await page.goto(`/conversations/${FAKE_UUID}`);
    const bubble = page.locator('[data-message-uuid="msg-B"]');
    await bubble.click();
    await page.keyboard.press('b');

    await expect(bubble.locator('[data-bookmarked]')).toHaveCount(1);
  });

  test('bookmark deep-link from Bookmarks tab scrolls and flashes the message', async ({ page }) => {
    await page.goto(`/conversations/${FAKE_UUID}`);
    const bubble = page.locator('[data-message-uuid="msg-B"]');
    await bubble.hover();
    await bubble.getByRole('button', { name: /bookmark/i }).click();
    await expect(bubble.locator('[data-bookmarked]')).toHaveCount(1);

    // Open the right panel and switch to Bookmarks tab.
    const isMac = (await page.evaluate(() => navigator.platform.includes('Mac')));
    await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');
    await page.getByRole('tab', { name: /bookmarks/i }).click();

    // Click the bookmark item.
    const item = page.locator('[data-bookmark-item]').first();
    await expect(item).toBeVisible();
    await item.click();

    // Target message should be visible and flashed.
    await expect(bubble).toBeVisible();
    await expect(bubble).toHaveClass(/ring-yellow-400/);
  });

  test('Export to Markdown button on Bookmarks tab triggers a download', async ({ page }) => {
    await page.goto(`/conversations/${FAKE_UUID}`);
    const bubble = page.locator('[data-message-uuid="msg-B"]');
    await bubble.hover();
    await bubble.getByRole('button', { name: /bookmark/i }).click();

    const isMac = (await page.evaluate(() => navigator.platform.includes('Mac')));
    await page.keyboard.press(isMac ? 'Meta+K' : 'Control+K');
    await page.getByRole('tab', { name: /bookmarks/i }).click();

    const exportButton = page.getByRole('button', { name: /export.*markdown/i });
    await expect(exportButton).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/bookmarks.*\.md/);
  });
});
