import { test, expect, makeSummary, makeMessage, makeDetail } from './fixtures'

/**
 * P1.3a — Frontend must hide the literal Claude Desktop "tool placeholder"
 * text the same way the backend's Markdown export does
 * (`backend/export.py::filter_tool_placeholders`).
 *
 * The placeholder string ("This block is not supported on your current
 * device yet.") leaks into the rendered viewer when the message body is
 * plain text rather than a fenced code block: the existing strip path
 * in `MarkdownRenderer.tsx` only catches the placeholder when it
 * arrives via the ReactMarkdown `code` component, i.e. inside ``` ```
 * fences. Real-world conversations also include the placeholder as a
 * bare paragraph, so the user sees the literal string in the bubble.
 *
 * Acceptance:
 *   - The bubble still renders (surrounding text "Hello" / "World" stays).
 *   - The literal placeholder string is gone.
 */

const CD = '00000000-0000-0000-0000-000000000fa1'
const PLACEHOLDER = 'This block is not supported on your current device yet.'

const summary = makeSummary({
  uuid: CD,
  name: 'Tool placeholder fixture',
  message_count: 1,
  human_message_count: 0,
  source: 'CLAUDE_AI',
})

// Reproduce the leak with BOTH shapes the renderer can pick:
//   - message.text (used when content[] is empty)
//   - content[0].text (used when content[] is non-empty)
const bodyText = `Hello\n\n${PLACEHOLDER}\n\nWorld`

const message = makeMessage({
  uuid: 'tp-m1',
  sender: 'assistant',
  text: bodyText,
  content: [{ type: 'text', text: bodyText }],
})

const detail = makeDetail(summary, [message])

test.describe('P1.3a — Tool placeholder text is hidden in the viewer', () => {
  test('bubble renders surrounding text but strips the literal placeholder line', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [CD]: detail } })
    await page.goto(`/conversations/${CD}`)

    const bubble = page.locator('[data-message-uuid="tp-m1"]')
    await expect(bubble).toBeVisible()

    // Surrounding text MUST still render — we are stripping the
    // placeholder line, not the whole bubble.
    await expect(bubble).toContainText('Hello')
    await expect(bubble).toContainText('World')

    // The literal Claude Desktop placeholder string MUST NOT appear.
    await expect(bubble).not.toContainText('This block is not supported')
  })
})
