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
    // Open the right panel (Cmd/Ctrl+K). Click main first to ensure focus.
    await page.locator('main').click();
    // Open the right panel by dispatching the keyboard shortcut. Use evaluate
    // to ensure focus context is correct (page.keyboard.press misses the
    // window listener intermittently in the test runner).
    await page.evaluate(() => {
      const isMac = navigator.platform.includes('Mac');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: isMac, ctrlKey: !isMac, bubbles: true }));
    });
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 10_000 });

    const tablist = page.getByRole('tablist');
    await expect(tablist).toBeVisible();
    await expect(tablist.getByRole('tab', { name: /search/i })).toBeVisible();
    await expect(tablist.getByRole('tab', { name: /bookmarks/i })).toBeVisible();
  });

  test('hover-revealed star creates a bookmark; another click removes it', async ({ page }) => {
    await page.goto(`/conversations/${FAKE_UUID}`);
    const bubble = page.locator('[data-message-uuid="msg-B"]');
    await bubble.hover();

    const star = bubble.getByRole('button', { name: /bookmark/i });
    await expect(star).toBeVisible();
    // The star sits in a `opacity-0 transition-opacity group-hover:opacity-100`
    // wrapper (~150ms Tailwind transition). Playwright's `.click()` happily
    // dispatches at any opacity > 0, which on cold render can land mid-transition
    // and miss. Wait for the opacity transition to settle to opacity:1 before
    // clicking. (Flake repro 2026-05-12, council fix.)
    await expect(star).toHaveCSS('opacity', '1');
    await star.click();

    // After bookmarking, star should reflect filled state via aria.
    await expect(bubble.locator('[data-bookmarked]')).toHaveCount(1);

    // Click again to remove.
    await bubble.hover();
    const star2 = bubble.getByRole('button', { name: /bookmark/i });
    await expect(star2).toHaveCSS('opacity', '1');
    await star2.click();
    await expect(bubble.locator('[data-bookmarked]')).toHaveCount(0);
  });

  test('pressing b on a focused message toggles its bookmark', async ({ page }) => {
    await page.goto(`/conversations/${FAKE_UUID}`);
    const bubble = page.locator('[data-message-uuid="msg-B"]');
    await bubble.click();
    // The 'b' handler reads `getSelectedMessageId()` from React context.
    // `bubble.click()` triggers two state updates (`setSelectedMessageIndex`
    // on the wrapper, then `setFocusArea('detail')` on the bubbling outer
    // container), and `page.keyboard.press('b')` can fire before React has
    // committed either, leading to a stale read that bookmarks msg-A (the
    // default index-0 selection). The bubble's inner content div gets
    // `ring-2 ring-blue-500 ring-offset-2` *only* when both states have
    // committed (`isKeyboardSelected = focusArea === 'detail' && uuid match`),
    // so waiting for that ring is a deterministic commit barrier.
    // TODO: replace with a `data-testid` or `aria-selected` attribute when
    // the bubble selection state gets a dedicated marker.
    // (Flake repro 2026-05-12, council fix.)
    await expect(bubble.locator('.ring-2')).toBeVisible();
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
    await page.locator('main').click();
    // Open the right panel by dispatching the keyboard shortcut. Use evaluate
    // to ensure focus context is correct (page.keyboard.press misses the
    // window listener intermittently in the test runner).
    await page.evaluate(() => {
      const isMac = navigator.platform.includes('Mac');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: isMac, ctrlKey: !isMac, bubbles: true }));
    });
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('tablist').getByRole('tab', { name: /bookmarks/i }).click();

    // Click the bookmark item.
    const item = page.locator('[data-bookmark-item]').first();
    await expect(item).toBeVisible();
    await item.click();

    // URL updates with ?m=msg-B, target bubble visible, panel closes.
    await expect(page).toHaveURL(/m=msg-B/);
    await expect(bubble).toBeVisible();
  });

  test('Export to Markdown button on Bookmarks tab triggers a download', async ({ page }) => {
    await page.goto(`/conversations/${FAKE_UUID}`);
    const bubble = page.locator('[data-message-uuid="msg-B"]');
    await bubble.hover();
    await bubble.getByRole('button', { name: /bookmark/i }).click();

    await page.locator('main').click();
    // Open the right panel by dispatching the keyboard shortcut. Use evaluate
    // to ensure focus context is correct (page.keyboard.press misses the
    // window listener intermittently in the test runner).
    await page.evaluate(() => {
      const isMac = navigator.platform.includes('Mac');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: isMac, ctrlKey: !isMac, bubbles: true }));
    });
    await expect(page.getByRole('tablist')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('tablist').getByRole('tab', { name: /bookmarks/i }).click();

    const exportButton = page.getByRole('button', { name: /export.*markdown/i });
    await expect(exportButton).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/bookmarks.*\.md/);
  });
});
