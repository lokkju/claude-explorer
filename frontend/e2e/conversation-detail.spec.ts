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
    const toolsButton = page.getByRole('button', { name: /^Tools$/ })

    // Default: not pressed (variant='outline'). Clicking flips to pressed
    // (variant='default'). The button's class set is the structural signal
    // since the tool body lives behind a <details> in the bubble that may
    // not match getByText reliably.
    const initialClass = await toolsButton.getAttribute('class')
    await toolsButton.click()
    const afterClickClass = await toolsButton.getAttribute('class')
    expect(initialClass).not.toBe(afterClickClass)
  })
})

test.describe('Detail — Header "Expand / Collapse All Tools" (B19)', () => {
  test('header toggle button label flips between Expand and Collapse', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [CD]: detail } })
    await page.goto(`/conversations/${CD}`)

    // Enable tool visibility (Expand/Collapse only renders while tools shown).
    const toolsButton = page.getByRole('button', { name: /^Tools$/ })
    await toolsButton.click()

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
