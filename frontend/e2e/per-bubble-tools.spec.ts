import { test, expect, Route, withNetRetry } from './fixtures';

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
    await withNetRetry(() => page.goto(`/conversations/${FAKE_UUID}`));

    // Show tool calls so the chevron is meaningful.
    // 2026-05-25: Tools control converted from Button to <input type="checkbox">
    // (see commit 5d7d97a). `.check()` is idempotent — sets to checked
    // regardless of starting state, replacing the prior aria-pressed branch
    // which never matched on a checkbox.
    const toolsCheckbox = page.getByTestId('header-show-tools-checkbox');
    await toolsCheckbox.check();

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

/**
 * M3 from PLANS/articles/part2_revision_plan.md.
 *
 * Article promise (line ~208 of part_2_web_app.md):
 *
 *   "alongside the Markdown and PDF export buttons, there's an
 *    *Expand / Collapse All Tools* control... It only appears when
 *    the Tools toggle is on."
 *
 * Implementation: ConversationPage.tsx wraps the Expand/Collapse
 * button in `{showToolCalls && (...)}`. This test pins both halves:
 *
 *   (a) Tools toggle OFF  -> Expand/Collapse button is NOT in DOM.
 *   (b) Tools toggle ON   -> Expand/Collapse button IS in DOM and
 *       clicking it flips every tool bubble between collapsed and
 *       expanded states at once.
 */
test.describe('M3: Expand/Collapse All Tools visibility-gated on Tools toggle', () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  test('Expand/Collapse button is hidden when Tools is off, visible when Tools is on', async ({
    page,
  }) => {
    await withNetRetry(() => page.goto(`/conversations/${FAKE_UUID}`));

    // Confirm we land in a known state. The default for showToolCalls
    // is false (SettingsContext.tsx:61), so Tools is off and the
    // Expand button must be absent.
    // 2026-05-25: Tools control is now a <input type="checkbox">.
    const toolsCheckbox = page.getByTestId('header-show-tools-checkbox');
    await expect(toolsCheckbox).toBeVisible();
    await expect(toolsCheckbox).not.toBeChecked();

    // Settle signal: the conversation header has rendered if the
    // Tools checkbox is visible — the conditional Expand button has
    // had its chance to render or not.
    const expandButton = page.getByRole('button', { name: /^(Expand|Collapse)$/ });
    await expect(expandButton).toHaveCount(0);

    // Flip Tools on. The conditional render means the Expand button
    // appears in the DOM.
    await toolsCheckbox.check();
    await expect(expandButton).toBeVisible();

    // Flip Tools back off. The button disappears again.
    await toolsCheckbox.uncheck();
    await expect(expandButton).toHaveCount(0);
  });

  test('clicking Expand/Collapse forces every tool block open or closed', async ({
    page,
  }) => {
    await withNetRetry(() => page.goto(`/conversations/${FAKE_UUID}`));

    // Tools ON so the Expand button + tool blocks render.
    // 2026-05-25: Tools control is now a <input type="checkbox">.
    await page.getByTestId('header-show-tools-checkbox').check();

    const bubble = page.locator('[data-message-uuid="msg-tools"]');
    await expect(bubble).toBeVisible();

    // The tool-block expanded state shows the JSON `<pre>` (for
    // tool_use) and the result body (for tool_result). When
    // expandAllTools=false (the default), neither is visible. When
    // true, both are. We pin behaviour by checking the rendered
    // contents, not internal CSS state.
    const inputJson = bubble.locator('pre', { hasText: '"path"' });
    const resultBody = bubble.locator('text=result body');

    // Initial state: tool blocks are collapsed → JSON/body hidden.
    await expect(inputJson).toHaveCount(0);
    await expect(resultBody).toHaveCount(0);

    // The Expand button label reflects the NEXT action, not the
    // current state. When expandAllTools=false, button reads
    // "Expand". After clicking, button reads "Collapse".
    const expandButton = page.getByRole('button', { name: /^(Expand|Collapse)$/ });
    await expect(expandButton).toHaveText(/^Expand$/);

    // Click to force-expand. Settle signal: the JSON content
    // appears in DOM.
    await expandButton.click();
    await expect(expandButton).toHaveText(/^Collapse$/);
    await expect(inputJson).toBeVisible();
    await expect(resultBody).toBeVisible();

    // Click to force-collapse. Settle signal: the JSON content is
    // gone again.
    await expandButton.click();
    await expect(expandButton).toHaveText(/^Expand$/);
    await expect(inputJson).toHaveCount(0);
    await expect(resultBody).toHaveCount(0);
  });
});
