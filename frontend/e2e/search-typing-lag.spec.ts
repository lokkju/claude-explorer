import { test, expect, makeSummary, makeMessage, makeDetail, withNetRetry } from './fixtures'
import type { Message } from '../src/lib/types'

/**
 * Manual finding 2026-05-04: typing into the SearchPanel input felt
 * laggy (~10s) on real-world conversations with hundreds of messages.
 * Root cause: SearchPanelContext.query updates on every keystroke;
 * ConversationPage subscribes via useSearchPanel(); without memo,
 * every keystroke re-rendered all 600+ MessageBubble children.
 *
 * Fix: React.memo wrapper on MessageBubble with explicit equality on
 * (message, isKeyboardSelected, conversationId, conversationSource).
 *
 * Test: a fixture conversation with 200 messages. Type a multi-char
 * query and assert that:
 *   - the input value reflects every keystroke verbatim (no missed
 *     characters from a stuck event loop), and
 *   - the typing→input-reflection delay is well under 1s per character
 *     (we just assert on the total elapsed for the fill, since
 *     headless rendering is fast enough that any blocked render
 *     would push us over).
 */

const C = '00000000-0000-0000-0000-0000000000c2'

const summary = makeSummary({
  uuid: C,
  source: 'CLAUDE_CODE',
  message_count: 200,
  project_path: '/fixture/project',
  project_name: 'project',
})

// 200 messages, alternating user/assistant, with chunky text so each
// MessageBubble actually renders work.
const messages: Message[] = []
for (let i = 0; i < 200; i++) {
  messages.push(
    makeMessage({
      uuid: `m-${i}`,
      sender: i % 2 === 0 ? 'human' : 'assistant',
      text: `Filler message #${i + 1} with enough text to make the bubble's render meaningful for the perf test.`,
      content: [
        {
          type: 'text',
          text: `Filler message #${i + 1} with enough text to make the bubble's render meaningful for the perf test.`,
        },
      ],
      parent_message_uuid: i === 0 ? null : `m-${i - 1}`,
    } as Partial<Message> & { uuid: string }),
  )
}
const detail = makeDetail(summary, messages)

test.describe('Search typing latency (manual finding 2026-05-04)', () => {
  test('typing 8 characters into the SearchPanel input completes under 2 seconds', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [C]: detail } })
    // Mocked /api/search resolves instantly with no matches — we want
    // to measure pure render latency on keystroke, not network.
    await page.route('**/api/search**', (route) => {
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          results: [],
          total_messages_matched: 0,
          returned_messages: 0,
          truncated: false,
        }),
      })
    })

    await withNetRetry(() => page.goto(`/conversations/${C}`))
    await expect(page.locator('[data-message-uuid="m-0"]')).toBeVisible({ timeout: 10_000 })

    // Open the SearchPanel.
    await page.locator('main').click()
    await page.keyboard.press('Meta+k')
    const input = page.locator('input[placeholder="Search messages..."]')
    await expect(input).toBeVisible()

    // Type a string and time the round-trip from keystroke to input
    // value reflecting every character.
    const text = 'NEEDLE_X'
    const start = Date.now()
    await input.pressSequentially(text, { delay: 0 })
    await expect(input).toHaveValue(text)
    const elapsed = Date.now() - start

    // 200 messages × ~8 keystrokes pre-fix would burn several seconds
    // of layout work. Post-memo we expect <2s comfortably; this is a
    // soft regression guard.
    expect(elapsed, `typing ${text} into search input took ${elapsed}ms`).toBeLessThan(2000)
  })
})
