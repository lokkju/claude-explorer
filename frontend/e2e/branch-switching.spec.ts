import { test, expect, Route, withNetRetry, installLocalPrefsMock } from './fixtures';

/**
 * Branch switching wire-up (Build-8 #6).
 *
 * Verifies that selecting a branch in the TreeViewModal actually changes the
 * displayed message stream by passing a `?leaf=<uuid>` query param.
 */

const FAKE_UUID = '00000000-0000-0000-0000-0000000000c6';

const baseConv = {
  uuid: FAKE_UUID,
  name: 'Branch fixture',
  summary: '',
  model: 'claude-sonnet-4-6',
  created_at: '2026-04-01T10:00:00Z',
  updated_at: '2026-04-01T10:00:00Z',
  is_starred: false,
  message_count: 4,
  human_message_count: 2,
  has_branches: true,
  source: 'CLAUDE_AI' as const,
  project_path: null,
  project_name: null,
  git_branch: null,
  subagents: [],
};

// Branch A path: m-root -> m-a-1 -> m-a-2 (leaf: m-a-2)
// Branch B path: m-root -> m-b-1 -> m-b-2 (leaf: m-b-2)

const allMessages = [
  { uuid: 'm-root', sender: 'human', text: 'common root', content: [{ type: 'text', text: 'common root' }], created_at: '2026-04-01T10:00:00Z', updated_at: '2026-04-01T10:00:00Z', truncated: false, parent_message_uuid: null, attachments: [], files: [] },
  { uuid: 'm-a-1', sender: 'assistant', text: 'BRANCH-A reply 1', content: [{ type: 'text', text: 'BRANCH-A reply 1' }], created_at: '2026-04-01T10:01:00Z', updated_at: '2026-04-01T10:01:00Z', truncated: false, parent_message_uuid: 'm-root', attachments: [], files: [] },
  { uuid: 'm-a-2', sender: 'human', text: 'BRANCH-A follow-up', content: [{ type: 'text', text: 'BRANCH-A follow-up' }], created_at: '2026-04-01T10:02:00Z', updated_at: '2026-04-01T10:02:00Z', truncated: false, parent_message_uuid: 'm-a-1', attachments: [], files: [] },
  { uuid: 'm-b-1', sender: 'assistant', text: 'BRANCH-B reply 1', content: [{ type: 'text', text: 'BRANCH-B reply 1' }], created_at: '2026-04-01T10:01:30Z', updated_at: '2026-04-01T10:01:30Z', truncated: false, parent_message_uuid: 'm-root', attachments: [], files: [] },
  { uuid: 'm-b-2', sender: 'human', text: 'BRANCH-B follow-up', content: [{ type: 'text', text: 'BRANCH-B follow-up' }], created_at: '2026-04-01T10:02:30Z', updated_at: '2026-04-01T10:02:30Z', truncated: false, parent_message_uuid: 'm-b-1', attachments: [], files: [] },
];

function branchFor(leaf: string): typeof allMessages {
  // Walk from leaf to root.
  const byUuid = new Map(allMessages.map((m) => [m.uuid, m]));
  const path: string[] = [];
  let cur: string | null = leaf;
  while (cur) {
    path.push(cur);
    cur = byUuid.get(cur)?.parent_message_uuid ?? null;
  }
  return path.reverse().map((u) => byUuid.get(u)!);
}

async function mockBackend(page: import('@playwright/test').Page) {
  await page.route('**/api/config', (route: Route) => {
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data_dir: '/tmp', conversation_count: 1 }) });
  });

  // Per-test preferences (defense in depth — see fixtures.installLocalPrefsMock
  // header for the Vite-proxy leak class this defends against). 2026-06-01.
  await installLocalPrefsMock(page);

  await page.route('**/api/conversations**', (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/conversations/${FAKE_UUID}/tree`)) {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          uuid: FAKE_UUID,
          root_messages: [
            {
              message: allMessages[0],
              children: [
                { message: allMessages[1], children: [{ message: allMessages[2], children: [] }] },
                { message: allMessages[3], children: [{ message: allMessages[4], children: [] }] },
              ],
            },
          ],
          active_path: ['m-root', 'm-a-1', 'm-a-2'],
        }),
      });
      return;
    }
    if (url.pathname.endsWith(`/conversations/${FAKE_UUID}`)) {
      const leaf = url.searchParams.get('leaf') ?? 'm-a-2';
      const messages = branchFor(leaf);
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ...baseConv,
          messages,
          current_leaf_message_uuid: leaf,
          file_path: '/tmp/x',
          compact_markers: [],
        }),
      });
      return;
    }
    route.fulfill({ contentType: 'application/json', body: JSON.stringify([baseConv]) });
  });
}

test.describe('Branch switching (Build-8 #6)', () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  test('selecting a branch in TreeViewModal updates the message stream and URL', async ({ page }) => {
    await withNetRetry(() => page.goto(`/conversations/${FAKE_UUID}`));

    // Initial: branch A is the displayed branch.
    await expect(page.getByText('BRANCH-A reply 1')).toBeVisible();
    await expect(page.getByText('BRANCH-B reply 1')).toHaveCount(0);

    // Open the tree modal.
    await page.getByRole('button', { name: /view branches/i }).click();
    // Modal title visible.
    await expect(page.getByText(/Conversation Tree/i)).toBeVisible();

    // Click the BRANCH-B leaf node.
    await page.getByText('BRANCH-B follow-up').first().click();

    // URL gains ?leaf=m-b-2.
    await expect(page).toHaveURL(/leaf=m-b-2/);

    // Stream now shows branch B and not branch A.
    await expect(page.getByText('BRANCH-B reply 1')).toBeVisible();
    await expect(page.getByText('BRANCH-A reply 1')).toHaveCount(0);
  });
});
