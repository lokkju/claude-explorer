import { test, expect, Route, withNetRetry } from './fixtures';

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

  // Per-test preferences store. Without this, /api/preferences leaks
  // through the Vite proxy to whatever backend is on :8765, so a
  // PREVIOUS run that toggled Show Compactions off persists across
  // tests in this file (compact-markers all depend on the marker
  // being visible). 2026-06-01 hardening — same pattern as bookmarks
  // and search-compact-auto-expand.
  const prefs: { data: Record<string, unknown> } = { data: {} };
  await page.route('**/api/preferences', async (route: Route) => {
    const req = route.request();
    const method = req.method();
    if (method === 'GET') {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ data: prefs.data }),
      });
      return;
    }
    if (method === 'PATCH' || method === 'PUT') {
      const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      const patch = (body.data ?? body) as Record<string, unknown>;
      prefs.data = method === 'PUT' ? patch : { ...prefs.data, ...patch };
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ data: prefs.data }),
      });
      return;
    }
    route.fulfill({ status: 405, body: 'Method Not Allowed' });
  });
}

test.describe('Compact markers', () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  test('renders inline compact-marker pill for both kinds', async ({ page }) => {
    await withNetRetry(() => page.goto(`/conversations/${FAKE_UUID}`));
    const markers = page.locator('[data-compact-marker]');
    await expect(markers).toHaveCount(2);
    await expect(markers.first()).toContainText(/Compacted/);
    await expect(markers.nth(1)).toContainText(/Compacted \(manual\)/);
  });

  test('manual compact shows the user prompt inline on the divider', async ({ page }) => {
    await withNetRetry(() => page.goto(`/conversations/${FAKE_UUID}`));
    await expect(
      page.locator('text=preserve context for the build phase').first()
    ).toBeVisible();
  });

  test('clicking the pill toggles the summary panel', async ({ page }) => {
    await withNetRetry(() => page.goto(`/conversations/${FAKE_UUID}`));
    const pill = page.locator('[data-compact-marker-pill]').first();
    await expect(pill).toBeVisible();
    await expect(page.locator('[data-compact-marker-panel]')).toHaveCount(0);
    await pill.click();
    const panel = page.locator('[data-compact-marker-panel]').first();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Summary');
  });

  test(']/[ navigate between compact markers', async ({ page }) => {
    await withNetRetry(() => page.goto(`/conversations/${FAKE_UUID}`));
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

  test('manual compact panel renders the user prompt as a UNIFIED purple subsection (no blue color family)', async ({ page }) => {
    // 2026-05-24 user report: "I don't see the user's /compact prompt"
    // — the data IS present (extracted into compact_marker.user_prompt)
    // and the viewer DOES render it, but the previous styling used
    // text-blue-700 / bg-blue-50 for the "You asked" subsection which
    // visually separated it from the purple "Summary" subsection
    // — they looked like two unrelated panels. User wants the prompt
    // "to fit in with the formatting of the Summary" i.e. one
    // unified compaction block.
    //
    // USER-OBSERVABLE CONTRACT pinned here:
    //   * Open the manual compact panel.
    //   * The "You asked" subsection's prompt body MUST share the
    //     purple color family with the rest of the panel (the panel
    //     border, the Summary label, the pill).
    //   * The blue color family (text-blue-700, bg-blue-50,
    //     text-blue-900, dark variants) MUST NOT appear inside the
    //     panel — that was the source of the visual disjunction.
    //
    // Black-box-ish: we assert on Tailwind class tokens because the
    // user's "fit in" is a visual claim that doesn't reduce to a
    // pure DOM-structure assertion. The class-token check is the
    // smallest stable proxy for the visual claim. If we ever swap
    // tailwind for another styling system we'll need to update this
    // test — that's an acceptable maintenance cost.
    await withNetRetry(() => page.goto(`/conversations/${FAKE_UUID}`));

    // Open the manual marker (index 1 of the 2 markers in the fixture).
    const manualPill = page.locator(
      '[data-compact-marker="m-compact-manual"] [data-compact-marker-pill]'
    );
    await manualPill.click();

    const panel = page
      .locator('[data-compact-marker="m-compact-manual"] [data-compact-marker-panel]');
    await expect(panel).toBeVisible();
    // Prompt copy is present (sanity check — pre-existing contract).
    await expect(panel).toContainText('preserve context for the build phase');

    // Snapshot the full panel HTML and assert color-family invariants.
    const html = await panel.evaluate((el) => el.outerHTML);

    // Negative-space assertion: blue tailwind tokens MUST NOT appear
    // anywhere in the panel HTML. This is the bug the user reported
    // — the "You asked" sub-block used to be styled blue.
    expect(html).not.toMatch(/text-blue-700/);
    expect(html).not.toMatch(/text-blue-900/);
    expect(html).not.toMatch(/bg-blue-50/);
    expect(html).not.toMatch(/bg-blue-950/);
    expect(html).not.toMatch(/text-blue-100/);
    expect(html).not.toMatch(/text-blue-300/);

    // Positive-space assertion: the purple color family is present
    // (the panel border AND a "You asked" sub-element MUST use it).
    expect(html).toMatch(/text-purple-700/);  // "You asked" label
    expect(html).toMatch(/bg-purple-50/);     // "You asked" body bg (light)
  });

  test('"Show Compactions" checkbox removes markers and shows them again', async ({ page }) => {
    // 2026-05-24: replaced the Hide/Show compact markers Button with
    // a "Show Compactions" checkbox so the on/off state is visually
    // obvious. `header-toggles-as-checkboxes.spec.ts` has the
    // canonical inversion test; this one is the legacy regression
    // guard for the original 2-marker fixture's toggle path.
    await withNetRetry(() => page.goto(`/conversations/${FAKE_UUID}`));
    await expect(page.locator('[data-compact-marker]').first()).toBeVisible();

    const showCompactions = page.locator(
      '[data-testid="header-show-compactions-checkbox"]',
    );
    await expect(showCompactions).toBeChecked();

    // Uncheck → markers hidden.
    await showCompactions.click();
    await expect(showCompactions).not.toBeChecked();
    await expect(page.locator('[data-compact-marker]')).toHaveCount(0);

    // Re-check → markers return.
    await showCompactions.click();
    await expect(showCompactions).toBeChecked();
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

    await withNetRetry(() => page.goto(`/conversations/${FAKE_UUID}`));
    await expect(page.locator('text=Continuing.').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /compact markers/i })).toHaveCount(0);
  });
});
