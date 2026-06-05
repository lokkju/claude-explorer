import { test, expect, makeSummary, makeMessage, makeDetail, withNetRetry } from './fixtures'
import type { Message } from '../src/lib/types'

/**
 * Issue #2 — message selection must follow the message UUID, not its
 * index in the visible message list.
 *
 * Repro: select message N. Toggle the Tools button (Show / Hide
 * tool calls). Today the visible-message filter
 * `messageHasVisibleContent(msg, showToolCalls)` shrinks or grows
 * the list, so `selectedMessageIndex` (a flat int) ends up pointing
 * at a DIFFERENT message UUID.
 *
 * Pass condition: after toggling Tools, the message with the
 * keyboard-selection ring is the SAME UUID as before. Both directions:
 *   - turning Tools ON (list grows: tool-only messages become visible)
 *   - turning Tools OFF (list shrinks: tool-only messages disappear)
 *
 * The "selected message" is the one whose <div data-message-uuid="X">
 * carries the `ring-2 ring-blue-500` classes (set by
 * MessageBubble's `isKeyboardSelected` prop).
 */

const SS = '00000000-0000-0000-0000-0000000000d9'

const summary = makeSummary({
  uuid: SS,
  name: 'Selection-stability fixture',
  source: 'CLAUDE_CODE',
  message_count: 5,
  human_message_count: 3,
  project_path: '/tmp/proj',
  project_name: 'proj',
})

// Build a conversation where some messages are tool-only (so they
// appear/disappear with the Tools toggle) interleaved with
// human + assistant text messages. The text messages should keep their
// selection no matter which way Tools toggles.
const messages: Message[] = [
  makeMessage({ uuid: 'ss-h1', sender: 'human', text: 'Question A', content: [{ type: 'text', text: 'Question A' }] }),
  // Tool-only assistant message — visible only when Tools=on.
  makeMessage({
    uuid: 'ss-tool',
    sender: 'assistant',
    text: '',
    content: [
      { type: 'tool_use', name: 'read_file', input: { path: '/tmp/x' } },
      { type: 'tool_result', content: [{ type: 'text', text: 'tool result body' }] },
    ],
    parent_message_uuid: 'ss-h1',
  } as Partial<Message> & { uuid: string }),
  makeMessage({
    uuid: 'ss-a1',
    sender: 'assistant',
    text: 'Answer A',
    content: [{ type: 'text', text: 'Answer A' }],
    parent_message_uuid: 'ss-tool',
  }),
  makeMessage({
    uuid: 'ss-h2',
    sender: 'human',
    text: 'Question B',
    content: [{ type: 'text', text: 'Question B' }],
    parent_message_uuid: 'ss-a1',
  }),
  makeMessage({
    uuid: 'ss-a2',
    sender: 'assistant',
    text: 'Answer B',
    content: [{ type: 'text', text: 'Answer B' }],
    parent_message_uuid: 'ss-h2',
  }),
]

const detail = makeDetail(summary, messages)

async function selectedUuid(page: import('@playwright/test').Page): Promise<string | null> {
  const handle = await page.evaluateHandle(() => {
    // Selection ring is `ring-2 ring-blue-500 ring-offset-2` on the
    // inner bubble content wrapper. The OUTER conversation pane uses
    // `ring-blue-500/50` (with opacity) when focusArea==='detail',
    // which we want to ignore here. The bubble's
    // `data-message-uuid="..."` lives on a parent div.
    const candidates = Array.from(document.querySelectorAll('.ring-offset-2'))
    for (const el of candidates) {
      const wrapper = el.closest('[data-message-uuid]')
      if (wrapper) return wrapper.getAttribute('data-message-uuid')
    }
    return null
  })
  const value = (await handle.jsonValue()) as string | null
  await handle.dispose()
  return value
}

test.describe('Selection follows message UUID across Tools toggle (Issue #2)', () => {
  test('selecting a text message and toggling Tools ON keeps the same message selected', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [SS]: detail } })
    await withNetRetry(page, () => page.goto(`/conversations/${SS}`))

    // Wait for the conversation header to render.
    await expect(page.getByRole('heading', { level: 1, name: /Selection-stability/ })).toBeVisible()

    // Click "Answer A" to focus + select that message.
    const answerABubble = page.locator('[data-message-uuid="ss-a1"]')
    await expect(answerABubble).toBeVisible()
    await answerABubble.click()

    // Verify the selection ring lands on ss-a1.
    await expect.poll(async () => await selectedUuid(page)).toBe('ss-a1')

    // Now toggle Tools ON. The tool-only message ss-tool becomes
    // visible, growing the visible-message list by one between ss-h1
    // and ss-a1. With an index-based selection, the ring would jump
    // back to ss-tool. With a UUID-based selection it stays on ss-a1.
    // 2026-05-25: Tools control is now a <input type="checkbox">.
    const toolsCheckbox = page.getByTestId('header-show-tools-checkbox')
    await toolsCheckbox.check()

    // Confirm tool-only bubble is now in the DOM (sanity check that the toggle worked).
    await expect(page.locator('[data-message-uuid="ss-tool"]')).toBeVisible()

    await expect.poll(async () => await selectedUuid(page)).toBe('ss-a1')
  })

  test('selecting a text message and toggling Tools OFF keeps the same message selected', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [SS]: detail } })
    await withNetRetry(page, () => page.goto(`/conversations/${SS}`))

    await expect(page.getByRole('heading', { level: 1, name: /Selection-stability/ })).toBeVisible()

    // Start with Tools ON so ss-tool is in the visible list.
    // 2026-05-25: Tools control is now a <input type="checkbox">.
    const toolsCheckbox = page.getByTestId('header-show-tools-checkbox')
    await toolsCheckbox.check()
    await expect(page.locator('[data-message-uuid="ss-tool"]')).toBeVisible()

    // Click "Answer B" — at the end of the list, so the index drift
    // is largest when ss-tool disappears.
    const answerBBubble = page.locator('[data-message-uuid="ss-a2"]')
    await answerBBubble.click()
    await expect.poll(async () => await selectedUuid(page)).toBe('ss-a2')

    // Toggle Tools OFF.
    await toolsCheckbox.uncheck()
    await expect(page.locator('[data-message-uuid="ss-tool"]')).toHaveCount(0)

    await expect.poll(async () => await selectedUuid(page)).toBe('ss-a2')
  })
})
