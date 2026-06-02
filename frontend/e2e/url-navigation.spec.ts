import { test, expect, Route, withNetRetry } from './fixtures';

/**
 * URL-parameter navigation (Build-6).
 *
 * Resource-oriented routes:
 *   /projects/<slug>                                    -> sidebar filtered to project
 *   /conversations/<id>                                 -> open conversation
 *   /conversations/<id>?m=<msgUuid>                     -> open + scroll + flash
 *   /conversations?q=<text>                             -> conv list with search
 *   /conversations?title=<pat>&filterMode=glob|regex    -> transient title filter
 *   /conversations?project=<slug>&q=<text>&title=<pat>  -> compose all three
 *
 * Mocks the backend so tests are deterministic.
 */

const conversations = [
  {
    uuid: 'aaaa-1111-1111-1111-111111111111',
    name: 'MCP server bootstrap notes',
    summary: '',
    model: 'claude-sonnet-4-6',
    created_at: '2026-04-01T10:00:00Z',
    updated_at: '2026-04-01T10:00:00Z',
    is_starred: false,
    message_count: 4,
    human_message_count: 2,
    has_branches: false,
    source: 'CLAUDE_CODE',
    project_path: '/Users/rpeck/Source/claude-explorer',
    project_name: 'claude-explorer',
    git_branch: 'main',
    subagents: [],
  },
  {
    uuid: 'bbbb-2222-2222-2222-222222222222',
    name: 'React component refactor',
    summary: '',
    model: 'claude-sonnet-4-6',
    created_at: '2026-04-02T10:00:00Z',
    updated_at: '2026-04-02T10:00:00Z',
    is_starred: false,
    message_count: 4,
    human_message_count: 2,
    has_branches: false,
    source: 'CLAUDE_CODE',
    project_path: '/Users/rpeck/Source/some-other',
    project_name: 'some-other',
    git_branch: 'main',
    subagents: [],
  },
  {
    uuid: 'cccc-3333-3333-3333-333333333333',
    name: 'MCP workspace integration',
    summary: '',
    model: 'claude-sonnet-4-6',
    created_at: '2026-04-03T10:00:00Z',
    updated_at: '2026-04-03T10:00:00Z',
    is_starred: false,
    message_count: 4,
    human_message_count: 2,
    has_branches: false,
    source: 'CLAUDE_CODE',
    project_path: '/Users/rpeck/Source/claude-explorer',
    project_name: 'claude-explorer',
    git_branch: 'main',
    subagents: [],
  },
];

const detailFor = (uuid: string) => {
  const summary = conversations.find((c) => c.uuid === uuid)!;
  const m1 = {
    uuid: 'msg-1',
    sender: 'human' as const,
    text: 'opening message',
    content: [{ type: 'text', text: 'opening message' }],
    created_at: summary.created_at,
    updated_at: summary.created_at,
    truncated: false,
    parent_message_uuid: null,
    attachments: [],
    files: [],
  };
  const m2 = {
    uuid: 'msg-2-deep-link',
    sender: 'assistant' as const,
    text: 'deep-linkable target message',
    content: [{ type: 'text', text: 'deep-linkable target message' }],
    created_at: summary.updated_at,
    updated_at: summary.updated_at,
    truncated: false,
    parent_message_uuid: 'msg-1',
    attachments: [],
    files: [],
  };
  return {
    ...summary,
    messages: [m1, m2],
    current_leaf_message_uuid: 'msg-2-deep-link',
    file_path: '/tmp/proj/fake.jsonl',
    compact_markers: [],
  };
};

async function mockBackend(page: import('@playwright/test').Page) {
  await page.route('**/api/conversations**', (route: Route) => {
    const url = route.request().url();
    const detailMatch = url.match(/\/api\/conversations\/([0-9a-fA-F-]+)(?:\/tree)?(?:\?|$)/);
    if (detailMatch) {
      const uuid = detailMatch[1];
      if (url.includes('/tree')) {
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ uuid, root_messages: [], active_path: [] }),
        });
        return;
      }
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(detailFor(uuid)),
      });
      return;
    }
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(conversations),
    });
  });

  await page.route('**/api/config', (route) => {
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data_dir: '/tmp', conversation_count: conversations.length }),
    });
  });
}

test.describe('URL-parameter navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  test('/projects/:slug filters the sidebar to that project', async ({ page }) => {
    await withNetRetry(() => page.goto('/projects/claude-explorer'));
    // Both claude-explorer-bound conversations should appear; the some-other one should not.
    await expect(page.getByText('MCP server bootstrap notes')).toBeVisible();
    await expect(page.getByText('MCP workspace integration')).toBeVisible();
    await expect(page.getByText('React component refactor')).toHaveCount(0);
  });

  test('/conversations/:id opens that conversation', async ({ page }) => {
    await withNetRetry(() => page.goto('/conversations/aaaa-1111-1111-1111-111111111111'));
    await expect(
      page.getByRole('heading', { name: /MCP server bootstrap notes/ })
    ).toBeVisible();
  });

  test('/conversations/:id?m=:msgUuid scrolls to and flashes the target message', async ({ page }) => {
    await withNetRetry(() => page.goto('/conversations/aaaa-1111-1111-1111-111111111111?m=msg-2-deep-link'));
    const target = page.locator('[data-message-uuid="msg-2-deep-link"]');
    await expect(target).toBeVisible();
    // Flash class is applied for ~2s; assert at least once.
    await expect(target).toHaveClass(/ring-yellow-400/);
  });

  test('/conversations?q=<text> applies search to the sidebar', async ({ page }) => {
    await withNetRetry(() => page.goto('/conversations?q=MCP'));
    // Should filter to titles containing MCP (case-insensitive).
    await expect(page.getByText('MCP server bootstrap notes')).toBeVisible();
    await expect(page.getByText('MCP workspace integration')).toBeVisible();
    await expect(page.getByText('React component refactor')).toHaveCount(0);

    // Search box should be prefilled.
    const search = page.getByPlaceholder(/Search titles/);
    await expect(search).toHaveValue('MCP');
  });

  test('/conversations?title=*MCP*&filterMode=glob applies transient glob title filter', async ({ page }) => {
    await withNetRetry(() => page.goto('/conversations?title=*MCP*&filterMode=glob'));
    await expect(page.getByText('MCP server bootstrap notes')).toBeVisible();
    await expect(page.getByText('MCP workspace integration')).toBeVisible();
    await expect(page.getByText('React component refactor')).toHaveCount(0);
  });

  test('/conversations?title=^React&filterMode=regex applies regex title filter', async ({ page }) => {
    await withNetRetry(() => page.goto('/conversations?title=' + encodeURIComponent('^React')) + '&filterMode=regex');
    await expect(page.getByText('React component refactor')).toBeVisible();
    await expect(page.getByText('MCP server bootstrap notes')).toHaveCount(0);
  });

  test('combined params project+q+title compose', async ({ page }) => {
    await withNetRetry(() => page.goto('/conversations?project=claude-explorer&q=MCP&title=*workspace*&filterMode=glob'));
    // Only "MCP workspace integration" matches all three.
    await expect(page.getByText('MCP workspace integration')).toBeVisible();
    await expect(page.getByText('MCP server bootstrap notes')).toHaveCount(0);
    await expect(page.getByText('React component refactor')).toHaveCount(0);
  });
});
