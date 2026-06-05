import { test, expect, makeSummary, makeMessage, makeDetail, withNetRetry } from './fixtures'
import type { Message } from '../src/lib/types'

/**
 * Smoke-test finding follow-up (2026-05-28 keyboard-nav smoke).
 *
 * Bug shape:
 *   When the user pages Alt+> to the bottom of a long conversation,
 *   the virtualizer unmounts the first message (it's far off-screen
 *   and outside the overscan window). Pressing Alt+< then sets
 *   `selectedMessageIndex` back to 0 in state, but the auto-scroll
 *   effect at ConversationPage.tsx:680-691 looks up the target by
 *   UUID in `messageRefs.current`, which is empty for the unmounted
 *   first message. `scrollIntoView` is called on `undefined` -> no-op.
 *   Viewport stays at the bottom. Selection ring disappears from view.
 *
 * Fix shape:
 *   When the ref lookup misses, fall back to
 *   `virtualizer.scrollToIndex(visIdx, { align: 'center' })`. The
 *   virtualizer can scroll to an item it hasn't mounted because it
 *   knows the offset table; the row will mount via the existing
 *   mounting path once the scroll-driven viewport reaches it.
 *
 * Contract pinned here (user-observable):
 *   After jumping to the bottom of a 600-message conversation with
 *   Alt+>, pressing Alt+< MUST bring the first message back into the
 *   viewport. The pre-fix code silently fails the assertion.
 */

const CONV_UUID = 'cccccccc-cccc-cccc-cccc-000000000003'
const TOTAL_MESSAGES = 600

function makeFiller(i: number): Message {
  const sender = i % 2 === 0 ? 'human' : 'assistant'
  // Long-enough text that no two messages collapse to the same
  // vertical position (forces real variable-height virtualization).
  const text = `Message ${i}. ${'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(6)}`
  return makeMessage({
    uuid: `kmsg-${String(i).padStart(4, '0')}`,
    sender,
    text,
    content: [{ type: 'text', text }],
    parent_message_uuid: i === 0 ? null : `kmsg-${String(i - 1).padStart(4, '0')}`,
  })
}

const summary = makeSummary({
  uuid: CONV_UUID,
  name: 'Alt+jump virtualizer recovery (600 msgs)',
  message_count: TOTAL_MESSAGES,
})

const messages: Message[] = Array.from({ length: TOTAL_MESSAGES }, (_, i) =>
  makeFiller(i),
)

const detail = makeDetail(summary, messages)

test.describe('Keyboard nav: Alt+< after Alt+> recovers viewport across virtualizer unmounts', () => {
  test.beforeEach(async ({ mockBackend, page }) => {
    await mockBackend({ conversations: [summary], details: { [CONV_UUID]: detail } })
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  test('Alt+< brings first message back into viewport even after virtualizer unmounted it', async ({
    page,
  }) => {
    await withNetRetry(page, () => page.goto(`/conversations/${CONV_UUID}`))

    // Wait for the first message to mount (initial render lands at top).
    const firstBubble = page.locator('[data-message-uuid="kmsg-0000"]')
    await expect(firstBubble).toBeVisible({ timeout: 15000 })

    // Click the first bubble. This sets focusArea='detail' AND seeds
    // selectedMessageIndex at 0. Equivalent to the user clicking into
    // the detail pane to start keyboard nav.
    await firstBubble.click()

    // Alt+> jumps to the last message. The virtualizer scrolls the
    // viewport to the bottom and unmounts the early rows.
    await page.keyboard.press('Alt+Shift+Period')

    // Wait until the last message is mounted and in viewport.
    const lastUuid = `kmsg-${String(TOTAL_MESSAGES - 1).padStart(4, '0')}`
    const lastBubble = page.locator(`[data-message-uuid="${lastUuid}"]`)
    await expect(lastBubble).toBeVisible({ timeout: 10000 })
    await expect(lastBubble).toBeInViewport()

    // Sanity: the first bubble is NO LONGER in the DOM. This is the
    // load-bearing pre-condition of the bug — if the first bubble
    // stayed mounted, the auto-scroll effect's ref lookup would
    // succeed and the bug would not manifest.
    await expect(firstBubble).toHaveCount(0)

    // Alt+< asks selectFirstMessage() to set selectedMessageIndex=0.
    // The auto-scroll effect fires. WITHOUT the fix:
    //   messageRefs.current.get('kmsg-0000') -> undefined ->
    //   scrollIntoView is never called -> viewport stays at the
    //   bottom -> first bubble never gets a chance to mount.
    // WITH the fix:
    //   virtualizer.scrollToIndex(0, { align: 'center' }) fires
    //   the fallback -> viewport scrolls to the top -> first bubble
    //   mounts and is in viewport.
    await page.keyboard.press('Alt+Shift+Comma')

    // The fix's user-observable contract.
    await expect(firstBubble).toBeVisible({ timeout: 5000 })
    await expect(firstBubble).toBeInViewport()
  })
})
