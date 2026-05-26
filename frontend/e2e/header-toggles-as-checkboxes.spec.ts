import { test, expect, makeSummary, makeMessage, makeDetail } from './fixtures'
import type { Message } from '../src/lib/types'

/**
 * 2026-05-24 UX request: the "Tools" and compact-markers toggles in
 * the conversation header used to be styled Buttons whose ON/OFF state
 * was visually ambiguous (variant difference). Replace with native
 * checkboxes labeled "Show Tools" and "Show Compactions" so the user
 * can read the state at a glance.
 *
 * Semantics:
 *   - "Show Tools" checked = showToolCalls=true (no inversion).
 *   - "Show Compactions" checked = !hideCompactMarkers (the underlying
 *     pref is `hideCompactMarkers`; the label is the user-facing
 *     positive — easy to get backward, so pin it).
 *
 * Three tests:
 *   1. Both checkboxes render with the right labels.
 *   2. "Show Tools" toggles tool visibility (checked ↔ tool messages render).
 *   3. "Show Compactions" toggles compact-marker visibility (checked ↔
 *      compact pill renders) — and the inversion is correct.
 */

const CONV = '00000000-0000-0000-0000-0000000ccc004'

const summary = makeSummary({
  uuid: CONV,
  source: 'CLAUDE_CODE',
  name: 'Header toggles fixture',
})

const messages: Message[] = [
  makeMessage({
    uuid: 'm-text',
    sender: 'human',
    text: 'plain text message',
    content: [{ type: 'text', text: 'plain text message' }],
  }),
  makeMessage({
    uuid: 'm-compact',
    sender: 'human',
    text: 'the compact summary body',
    content: [{ type: 'text', text: 'the compact summary body' }],
  }),
  makeMessage({
    uuid: 'm-tool',
    sender: 'assistant',
    text: '',
    content: [
      {
        type: 'tool_use',
        name: 'Bash',
        input: { command: 'ls' },
      },
    ],
  }),
] as Message[]

const detail = makeDetail(summary, messages, {
  compact_markers: [
    {
      message_uuid: 'm-compact',
      summary_text: 'the compact summary body',
      timestamp: '2026-04-01T11:00:00Z',
      kind: 'manual',
      user_prompt: 'preserve context',
    },
  ],
})

test.describe('Conversation header toggles render as checkboxes (2026-05-24)', () => {
  test('both toggles render as checkboxes with the expected labels', async ({
    page,
    mockBackend,
  }) => {
    await mockBackend({
      conversations: [summary],
      details: { [CONV]: detail },
    })
    await page.goto(`/conversations/${CONV}`)

    const toolsCheckbox = page.locator(
      '[data-testid="header-show-tools-checkbox"]',
    )
    const compactionsCheckbox = page.locator(
      '[data-testid="header-show-compactions-checkbox"]',
    )

    await expect(toolsCheckbox).toBeVisible()
    await expect(compactionsCheckbox).toBeVisible()

    // The labels (rendered as sibling spans inside the wrapper <label>)
    // surface the user-facing copy.
    await expect(page.getByText('Show Tools')).toBeVisible()
    await expect(page.getByText('Show Compactions')).toBeVisible()
  })

  test('"Show Tools" checkbox toggles tool-message visibility', async ({
    page,
    mockBackend,
  }) => {
    await mockBackend({
      conversations: [summary],
      details: { [CONV]: detail },
    })
    await page.goto(`/conversations/${CONV}`)

    const toolsCheckbox = page.locator(
      '[data-testid="header-show-tools-checkbox"]',
    )
    // Default state: showToolCalls is OFF (per Settings default), so
    // the checkbox is UNCHECKED and tool message is NOT visible.
    await expect(toolsCheckbox).not.toBeChecked()
    await expect(page.locator('[data-message-uuid="m-tool"]')).toHaveCount(0)

    // Check → tool message appears.
    await toolsCheckbox.check()
    await expect(toolsCheckbox).toBeChecked()
    await expect(page.locator('[data-message-uuid="m-tool"]')).toBeVisible()
  })

  test('"Show Compactions" checkbox toggles compact-marker visibility (no inversion bug)', async ({
    page,
    mockBackend,
  }) => {
    await mockBackend({
      conversations: [summary],
      details: { [CONV]: detail },
    })
    await page.goto(`/conversations/${CONV}`)

    const compactionsCheckbox = page.locator(
      '[data-testid="header-show-compactions-checkbox"]',
    )

    // Default: hideCompactMarkers=false → "Show Compactions" CHECKED.
    // The marker pill IS visible.
    await expect(compactionsCheckbox).toBeChecked()
    await expect(page.locator('[data-compact-marker]')).toBeVisible()

    // Uncheck via click() (not .uncheck()) — Playwright's .uncheck/.check
    // helpers have a state-precondition check that races with React's
    // commit; click() is the deterministic equivalent that just fires
    // the event and lets React reconcile.
    await compactionsCheckbox.click()
    await expect(compactionsCheckbox).not.toBeChecked()
    await expect(page.locator('[data-compact-marker]')).toHaveCount(0)

    // Re-check.
    await compactionsCheckbox.click()
    await expect(compactionsCheckbox).toBeChecked()
    await expect(page.locator('[data-compact-marker]')).toBeVisible()
  })

  test('"Show Compactions" drives export `include_compact` URL query (2026-05-24 unified-toggle)', async ({
    page,
    mockBackend,
  }) => {
    // 2026-05-24 user request: "Remove the [export.includeCompactContent]
    // flag from the Settings, and use the visibility flag for the UI for
    // exports. If compacts are visible, exports should expand the user
    // prompt (if any) and the Summary."
    //
    // The conversation-header "Show Compactions" checkbox now drives
    // BOTH surfaces (viewer + exports) — the export pref in Settings
    // is removed entirely. This test pins the new contract by spying
    // on the Markdown export URL and asserting include_compact mirrors
    // the checkbox state.
    //
    // USER-OBSERVABLE CONTRACT pinned here:
    //   * Show Compactions CHECKED → export URL has
    //     include_compact=true
    //   * Show Compactions UNCHECKED → export URL has
    //     include_compact=false
    //
    // We use the Markdown export (inline mode = no dialog branching)
    // because PDF export is async-toast-heavy and the export click
    // here is fire-and-forget. Markdown export is the cleanest
    // single-URL surface to inspect.
    await mockBackend({
      conversations: [summary],
      details: { [CONV]: detail },
    })

    // Capture every export URL the page tries to fetch. We don't
    // actually need to deliver the bytes — the test cares only about
    // the URL the frontend BUILT.
    const exportUrls: string[] = []
    await page.route('**/api/conversations/*/export/markdown**', async (route) => {
      exportUrls.push(route.request().url())
      await route.fulfill({
        status: 200,
        contentType: 'text/markdown',
        body: '# stub',
      })
    })

    await page.goto(`/conversations/${CONV}`)

    const compactionsCheckbox = page.locator(
      '[data-testid="header-show-compactions-checkbox"]',
    )
    await expect(compactionsCheckbox).toBeChecked()

    // CHECKED → export URL carries include_compact=true.
    await page
      .getByRole('button', { name: /^markdown$/i })
      .click()
    // The markdown dialog opens — pick "Inline" (the default) and
    // click Download. (The dialog is conditionally rendered only when
    // the user clicks the Markdown header button.)
    const dialog = page.locator('[data-testid="markdown-export-dialog"]')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /^download$/i }).click()
    await expect.poll(() => exportUrls.length).toBeGreaterThanOrEqual(1)
    expect(exportUrls.at(-1)).toContain('include_compact=true')

    // Uncheck → next export URL carries include_compact=false.
    await compactionsCheckbox.click()
    await expect(compactionsCheckbox).not.toBeChecked()
    await page
      .getByRole('button', { name: /^markdown$/i })
      .click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /^download$/i }).click()
    await expect.poll(() => exportUrls.length).toBeGreaterThanOrEqual(2)
    expect(exportUrls.at(-1)).toContain('include_compact=false')
  })

  test('"Show Compactions" OFF also HIDES the underlying isCompactSummary message body (2026-05-24 user report)', async ({
    page,
    mockBackend,
  }) => {
    // Regression: before 2026-05-24, unchecking "Show Compactions" hid
    // the marker PILL UI but left the underlying isCompactSummary
    // message body rendered as a plain user-prompt-styled bubble (the
    // user's screenshot showed the verbose LLM summary text rendering
    // as if it were a normal user message). The fix extends
    // `computeVisibleMessages` to DROP messages whose UUID is in the
    // compact_markers set when `hideCompactSummaries=true`.
    //
    // User-observable contract: with the checkbox OFF, neither the
    // pill nor the summary body's data-message-uuid bubble should
    // appear in the DOM.
    await mockBackend({
      conversations: [summary],
      details: { [CONV]: detail },
    })
    await page.goto(`/conversations/${CONV}`)

    const compactionsCheckbox = page.locator(
      '[data-testid="header-show-compactions-checkbox"]',
    )

    // Default ON: pill visible AND the underlying message UUID
    // (`m-compact`) is in the DOM but rendered as the CompactMarker
    // pill wrapper (NOT as a MessageBubble).
    await expect(compactionsCheckbox).toBeChecked()
    await expect(page.locator('[data-compact-marker]')).toBeVisible()

    // Uncheck → both the pill AND the underlying message UUID
    // disappear from the DOM entirely. Pre-fix, the underlying
    // [data-message-uuid="m-compact"] would still render as a normal
    // user bubble showing the full summary text — the bug.
    await compactionsCheckbox.click()
    await expect(compactionsCheckbox).not.toBeChecked()
    await expect(page.locator('[data-compact-marker]')).toHaveCount(0)
    await expect(
      page.locator('[data-message-uuid="m-compact"]'),
    ).toHaveCount(0)

    // Surrounding real messages still render (negative-space
    // assertion: OFF hides ONLY the compact summary, not adjacent
    // conversation content).
    await expect(page.locator('[data-message-uuid="m-text"]')).toBeVisible()
  })
})
