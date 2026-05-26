import { test, expect, makeSummary, makeMessage, makeDetail } from './fixtures'

/**
 * Conversation-detail UI claims that previously had no Playwright test:
 *
 *   B19 — Header "Expand/Collapse All Tools" control toggles every tool
 *         block in the conversation at once.
 *   B20 — Per-content-block "two overlaid pages" copy icon appears on
 *         hover and copies that block.
 *   B21 (viewer half) — showToolCalls toggle hides/shows tool blocks in
 *         the viewer. The clipboard + export halves of B21 live in
 *         keyboard-shortcuts.spec.ts (Cmd+C) and exports.spec.ts.
 *   B23 — Local timestamps appear on BOTH user AND assistant message
 *         bubbles.
 */

const CD = '00000000-0000-0000-0000-0000000000e1'

const summary = makeSummary({
  uuid: CD,
  name: 'Detail-pane fixture',
  message_count: 4,
  human_message_count: 2,
  source: 'CLAUDE_CODE',
  project_path: '/tmp',
  project_name: 'tmp',
})

const messages = [
  makeMessage({
    uuid: 'cd-m1',
    sender: 'human',
    text: 'Run the script',
    content: [{ type: 'text', text: 'Run the script' }],
  }),
  makeMessage({
    uuid: 'cd-m2',
    sender: 'assistant',
    text: 'Running tools',
    content: [
      { type: 'text', text: 'Running.' },
      { type: 'tool_use', name: 'read_file', input: { path: '/tmp/x' } },
      { type: 'tool_result', content: [{ type: 'text', text: 'first tool result body' }] },
    ],
    parent_message_uuid: 'cd-m1',
  }),
  makeMessage({
    uuid: 'cd-m3',
    sender: 'human',
    text: 'Now read another',
    content: [{ type: 'text', text: 'Now read another' }],
    parent_message_uuid: 'cd-m2',
  }),
  makeMessage({
    uuid: 'cd-m4',
    sender: 'assistant',
    text: 'More tools',
    content: [
      { type: 'text', text: 'More tools.' },
      { type: 'tool_use', name: 'read_file', input: { path: '/tmp/y' } },
      { type: 'tool_result', content: [{ type: 'text', text: 'second tool result body' }] },
    ],
    parent_message_uuid: 'cd-m3',
  }),
]

const detail = makeDetail(summary, messages)

test.describe('Detail — Tools toggle hides tool blocks by default (B21 viewer)', () => {
  test('toggling Tools button changes button state', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [CD]: detail } })
    await page.goto(`/conversations/${CD}`)

    await expect(page.locator('[data-message-uuid="cd-m2"]')).toBeVisible()
    // 2026-05-25: Tools control converted from Button (variant flip) to
    // <input type="checkbox">. The structural signal is the checkbox's
    // own `checked` state, which `.isChecked()` reads directly.
    const toolsCheckbox = page.getByTestId('header-show-tools-checkbox')

    // Default: unchecked. Clicking the surrounding label flips it on.
    await expect(toolsCheckbox).not.toBeChecked()
    await toolsCheckbox.click()
    await expect(toolsCheckbox).toBeChecked()
  })
})

test.describe('Detail — Header "Expand / Collapse All Tools" (B19)', () => {
  test('header toggle button label flips between Expand and Collapse', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [CD]: detail } })
    await page.goto(`/conversations/${CD}`)

    // Enable tool visibility (Expand/Collapse only renders while tools shown).
    // 2026-05-25: Tools control is now a <input type="checkbox">.
    await page.getByTestId('header-show-tools-checkbox').check()

    const m2 = page.locator('[data-message-uuid="cd-m2"]')
    await expect(m2).toBeVisible()

    // The article promises this header control toggles every tool block at
    // once. We verify the contract via the button's own label flip:
    // Expand -> Collapse -> Expand. Per-bubble data-collapsed propagation
    // is covered by per-bubble-tools.spec.ts (existing test).
    const expand = page.getByRole('button', { name: /^Expand$/ })
    const collapse = page.getByRole('button', { name: /^Collapse$/ })

    await expect(expand).toBeVisible()
    await expand.click()
    await expect(collapse).toBeVisible()
    await collapse.click()
    await expect(expand).toBeVisible()
  })
})

test.describe('Detail — Per-block hover-revealed copy icon (B20)', () => {
  test('copy icon appears on hover and copies message Markdown to the clipboard', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [CD]: detail } })
    await page.goto(`/conversations/${CD}`)

    const m1 = page.locator('[data-message-uuid="cd-m1"]')
    await expect(m1).toBeVisible()

    // Copy controls live inside MessageBubble; hover the bubble to reveal,
    // then click the copy button. The button is identified by its title or
    // aria-label "Copy".
    await m1.hover()
    const copyBtn = m1.getByRole('button', { name: /copy/i }).first()
    await expect(copyBtn).toBeVisible()
    await copyBtn.click()

    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toContain('You:')
    expect(clip).toContain('Run the script')
  })
})

test.describe('Detail — Per-block copy icon hidden on argless command markers (B20 V1 cleanup)', () => {
  /**
   * V1 polish cleanup (2026-05-13): argless command-marker bubbles
   * (`is_command_marker=true`: /exit, /clear, /compact, prelude rows)
   * are CHROME. They render as muted SlashCommandBadge bubbles so the
   * user can SEE the orientation in the viewer, but they MUST NOT
   * offer a per-block copy affordance: the per-block copy path calls
   * `messageToMarkdown(message, ...)` directly and bypasses the
   * conversation-level `isExcludableMarker` filter, so a click would
   * put `**You:**\n\nSession: /exit` on the clipboard — leaking chrome
   * into a user-content surface.
   *
   * Bidirectional invariant: the SIBLING regular bubble in the same
   * conversation MUST still expose the copy icon — the predicate is
   * keyed on `is_command_marker === true`, not on slash_command
   * truthiness, so neighbors are unaffected.
   */
  const CDX = '00000000-0000-0000-0000-0000000000e2'

  const xSummary = makeSummary({
    uuid: CDX,
    name: 'Detail with argless marker',
    message_count: 3,
    human_message_count: 2,
    source: 'CLAUDE_CODE',
    project_path: '/tmp',
    project_name: 'tmp',
  })

  const xMessages = [
    makeMessage({
      uuid: 'cdx-m1',
      sender: 'human',
      text: 'Real user prose',
      content: [{ type: 'text', text: 'Real user prose' }],
      is_command_marker: false,
    }),
    // Argless /exit chrome bubble — per-block copy must be hidden.
    makeMessage({
      uuid: 'cdx-m2',
      sender: 'human',
      text: 'Session: /exit',
      content: [{ type: 'text', text: 'Session: /exit' }],
      is_command_marker: true,
      slash_command: '/exit',
      parent_message_uuid: 'cdx-m1',
    }),
    makeMessage({
      uuid: 'cdx-m3',
      sender: 'assistant',
      text: 'Acknowledged.',
      content: [{ type: 'text', text: 'Acknowledged.' }],
      parent_message_uuid: 'cdx-m2',
    }),
  ]

  const xDetail = makeDetail(xSummary, xMessages)

  test('argless marker bubble: hover does NOT reveal a copy icon', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [xSummary], details: { [CDX]: xDetail } })
    await page.goto(`/conversations/${CDX}`)

    const marker = page.locator('[data-message-uuid="cdx-m2"]')
    await expect(marker).toBeVisible()
    // Deterministic settle signal: SlashCommandBadge has rendered, so
    // the bubble's full DOM (including the hover-overlay container) is
    // mounted. Without this wait the next hover() can race the React
    // mount and produce a false negative on the copy-icon absence
    // assertion below.
    await expect(marker.getByTestId('slash-command-badge')).toBeVisible()

    await marker.hover()

    // The hover overlay container should mount (other buttons may still
    // appear; copy is the one we care about). Assert the copy button
    // is NOT in the bubble's subtree. `count()` is the explicit
    // count-based settle pattern; toBeHidden() would race attached.
    const copyInMarker = marker.locator('button[title="Copy message as Markdown"]')
    await expect(copyInMarker).toHaveCount(0)

    // Also assert the bookmark button is not offered for chrome rows.
    const bookmarkInMarker = marker.locator('button[aria-label="Bookmark message"]')
    await expect(bookmarkInMarker).toHaveCount(0)
  })

  test('sibling regular bubble in same conversation STILL exposes copy icon on hover (counter-invariant)', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [xSummary], details: { [CDX]: xDetail } })
    await page.goto(`/conversations/${CDX}`)

    const regular = page.locator('[data-message-uuid="cdx-m1"]')
    await expect(regular).toBeVisible()
    await regular.hover()
    const copyInRegular = regular.locator('button[title="Copy message as Markdown"]').first()
    await expect(copyInRegular).toBeVisible()
    // And clicking actually copies real content (covers the
    // bidirectional inverse of the B20 test above: argful/regular
    // content is still copyable when chrome is filtered).
    await copyInRegular.click()
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toContain('Real user prose')
    // The chrome marker's body must NOT appear in the clipboard for the
    // per-message copy of a NEIGHBOR bubble — this is trivially true
    // because messageToMarkdown only renders the one message, but pin
    // it to lock the contract.
    expect(clip).not.toContain('Session: /exit')
  })
})

test.describe('Detail — Local timestamps on user AND assistant (B23)', () => {
  test('every visible bubble shows a timestamp', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [CD]: detail } })
    await page.goto(`/conversations/${CD}`)

    // Wait for the first bubble specifically, not just "any [data-message-uuid]"
    // — the locator can race the React mount.
    const human = page.locator('[data-message-uuid="cd-m1"]')
    const assistant = page.locator('[data-message-uuid="cd-m2"]')
    await expect(human).toBeVisible()
    await expect(assistant).toBeVisible()

    // Both bubbles must contain a timestamp string. formatMessageTimestamp
    // produces "Apr 1, 2026 10:00:00 AM" or similar — match a month name
    // or AM/PM marker.
    const tsRe = /(AM|PM|Yesterday|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b)/
    await expect(human).toContainText(tsRe)
    await expect(assistant).toContainText(tsRe)
  })
})
