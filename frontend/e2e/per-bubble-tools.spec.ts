import { test, expect, Route } from '@playwright/test';

/**
 * Per-bubble tool-block toggle (Build-8 #5).
 */

const FAKE_UUID = '00000000-0000-0000-0000-0000000000c5';

const baseConv = {
  uuid: FAKE_UUID,
  name: 'Tool fixture',
  summary: '',
  model: 'claude-sonnet-4-6',
  created_at: '2026-04-01T10:00:00Z',
  updated_at: '2026-04-01T10:00:00Z',
  is_starred: false,
  is_temporary: false,
  message_count: 1,
  human_message_count: 0,
  has_branches: false,
  source: 'CLAUDE_CODE' as const,
  project_path: '/tmp',
  project_name: 'tmp',
  git_branch: '',
  subagents: [],
};

const messageWithTools = {
  uuid: 'msg-tools',
  sender: 'assistant' as const,
  text: 'Running tools',
  content: [
    { type: 'text', text: 'Running tools.' },
    { type: 'tool_use', name: 'read_file', input: { path: '/tmp/x' } },
    { type: 'tool_result', content: [{ type: 'text', text: 'result body' }] },
  ],
  created_at: '2026-04-01T10:00:00Z',
  updated_at: '2026-04-01T10:00:00Z',
  truncated: false,
  parent_message_uuid: null,
  attachments: [],
  files: [],
};

async function mockBackend(page: import('@playwright/test').Page) {
  await page.route('**/api/config', (route: Route) => {
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data_dir: '/tmp', conversation_count: 1 }) });
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
          messages: [messageWithTools],
          current_leaf_message_uuid: 'msg-tools',
          file_path: '/tmp/x',
          compact_markers: [],
        }),
      });
      return;
    }
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([baseConv]) });
  });
}

test.describe('Per-bubble tool-block toggle', () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  test('per-bubble chevron toggles data-collapsed on the bubble', async ({ page }) => {
    await page.goto(`/conversations/${FAKE_UUID}`);

    // Show tool calls so the chevron is meaningful.
    const toolsButton = page.getByRole('button', { name: /^Tools$/ });
    if (!(await toolsButton.evaluate((el) => el.getAttribute('aria-pressed')))) {
      await toolsButton.click();
    }

    const bubble = page.locator('[data-message-uuid="msg-tools"]');
    await expect(bubble).toBeVisible();

    const chevron = bubble.getByRole('button', { name: /tools/i }).first();
    await expect(chevron).toBeVisible();

    // Initially expanded -> data-collapsed not present.
    await expect(bubble).not.toHaveAttribute('data-collapsed', '');

    await chevron.click();
    await expect(bubble).toHaveAttribute('data-collapsed', '');

    await chevron.click();
    await expect(bubble).not.toHaveAttribute('data-collapsed', '');
  });
});
