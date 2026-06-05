import { test, expect, makeSummary, makeMessage, makeDetail, type Page, withNetRetry } from './fixtures'
import type { Message } from '../src/lib/types'

/**
 * Manual finding 2026-05-04: three bugs in the new CC image lightbox.
 *   1. "Open original in new tab" opens an empty tab (data: URI source
 *      gets blocked by the browser's modern data-URL-in-new-tab
 *      security policy).
 *   2. Esc doesn't close the lightbox.
 *   3. Right/Left arrow keys don't navigate between images in the
 *      same bubble.
 *
 * Root cause for (2) and (3): useKeyboardShortcuts.ts has global
 * Escape and ArrowLeft handlers gated on focusArea === 'detail'. When
 * the user clicks a message thumbnail, focusArea is 'detail'; the
 * lightbox opens; Esc/ArrowLeft fire BUT the global handler runs
 * first and `e.preventDefault()`s them, so the lightbox's local
 * keydown listener never sees the events.
 *
 * Tests assert the desired behavior directly. RED before fix.
 */

const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const C = '00000000-0000-0000-0000-0000000000c1'

const summary = makeSummary({
  uuid: C,
  source: 'CLAUDE_CODE',
  message_count: 1,
  project_path: '/fixture/project',
  project_name: 'project',
})

const m = makeMessage({
  uuid: 'cc-multi',
  sender: 'human',
  text: 'three images inline',
  content: [
    { type: 'text', text: 'three images inline' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: TINY_PNG_B64 } },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: TINY_PNG_B64 } },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: TINY_PNG_B64 } },
  ],
} as Partial<Message> & { uuid: string })
const detail = makeDetail(summary, [m])

async function openLightboxWithDetailFocus(page: Page) {
  // Force the same precondition as real usage: the user has clicked
  // into the message pane, so focusArea === 'detail'. That's when the
  // global useKeyboardShortcuts Esc/ArrowLeft handlers historically
  // ate the lightbox's keys.
  // We dispatch a click directly on the conversation root to set the
  // ConversationPage's onClick → setFocusArea('detail').
  await page.locator('[data-testid="message-stream"]').click({ position: { x: 5, y: 5 } })
  await page.locator('[data-content-image]').first().click()
}

test.describe('Image lightbox cross-message navigation (manual finding 2026-05-04)', () => {
  test('ArrowRight navigates from message A image to message B image', async ({ page, mockBackend }) => {
    const summaryX = makeSummary({
      uuid: '00000000-0000-0000-0000-0000000000c9',
      source: 'CLAUDE_CODE',
      message_count: 2,
      project_path: '/fixture/project',
      project_name: 'project',
    })
    const m1 = makeMessage({
      uuid: 'msg-A',
      sender: 'human',
      text: 'first message',
      content: [
        { type: 'text', text: 'first message' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: TINY_PNG_B64 } },
      ],
    } as Partial<Message> & { uuid: string })
    const m2 = makeMessage({
      uuid: 'msg-B',
      sender: 'assistant',
      text: 'second message',
      content: [
        { type: 'text', text: 'second message' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: TINY_PNG_B64 } },
      ],
      parent_message_uuid: 'msg-A',
    } as Partial<Message> & { uuid: string })
    const detailX = makeDetail(summaryX, [m1, m2])
    await mockBackend({ conversations: [summaryX], details: { [summaryX.uuid]: detailX } })

    await withNetRetry(page, () => page.goto(`/conversations/${summaryX.uuid}`))
    // Click into the message pane so focusArea === 'detail' (otherwise
    // the global keyboard handler's gate doesn't apply and the test
    // doesn't reproduce the user's path).
    await page.locator('[data-testid="message-stream"]').click({ position: { x: 5, y: 5 } })

    // Open the lightbox by clicking message A's image tile.
    const firstTile = page.locator('[data-message-uuid="msg-A"] [data-content-image]').first()
    await expect(firstTile).toBeVisible({ timeout: 5_000 })
    await firstTile.click()

    const lightbox = page.getByTestId('image-lightbox')
    await expect(lightbox).toBeVisible({ timeout: 5_000 })

    // The catalog spans the whole conversation, not just msg-A. So
    // the counter should read "1 / 2" (this image is #1 of all 2 in
    // the conversation), and ArrowRight should advance to #2.
    await expect(lightbox).toContainText('1 / 2')

    await page.keyboard.press('ArrowRight')
    await expect(lightbox).toContainText('2 / 2')

    // The image now showing is from msg-B — the lightbox header
    // shows the conversation-level filename ("inline-image-2.png" for
    // the second image we cataloged). We assert via the counter
    // change since file_name is implementation-detail.

    // Wraps back to 1 / 2.
    await page.keyboard.press('ArrowRight')
    await expect(lightbox).toContainText('1 / 2')

    // Backward.
    await page.keyboard.press('ArrowLeft')
    await expect(lightbox).toContainText('2 / 2')

    // Esc still closes.
    await page.keyboard.press('Escape')
    await expect(lightbox).not.toBeVisible({ timeout: 3_000 })
  })
})

test.describe('Image lightbox keyboard + open-original (manual finding 2026-05-04)', () => {
  test('Esc closes the lightbox', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [C]: detail } })
    await withNetRetry(page, () => page.goto(`/conversations/${C}`))
    await openLightboxWithDetailFocus(page)
    const lightbox = page.getByTestId('image-lightbox')
    await expect(lightbox).toBeVisible({ timeout: 5000 })

    await page.keyboard.press('Escape')
    await expect(lightbox).not.toBeVisible({ timeout: 3000 })
  })

  test('ArrowRight / ArrowLeft navigate between images', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [C]: detail } })
    await withNetRetry(page, () => page.goto(`/conversations/${C}`))
    await openLightboxWithDetailFocus(page)
    const lightbox = page.getByTestId('image-lightbox')
    await expect(lightbox).toBeVisible({ timeout: 5000 })

    // Counter starts at "1 / 3".
    await expect(lightbox).toContainText('1 / 3')

    await page.keyboard.press('ArrowRight')
    await expect(lightbox).toContainText('2 / 3')

    await page.keyboard.press('ArrowRight')
    await expect(lightbox).toContainText('3 / 3')

    // Wraps back to 1/3.
    await page.keyboard.press('ArrowRight')
    await expect(lightbox).toContainText('1 / 3')

    // Backward.
    await page.keyboard.press('ArrowLeft')
    await expect(lightbox).toContainText('3 / 3')
  })

  test('Open original button uses a non-data: URL (works in all browsers)', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [C]: detail } })
    await withNetRetry(page, () => page.goto(`/conversations/${C}`))
    await openLightboxWithDetailFocus(page)
    const lightbox = page.getByTestId('image-lightbox')
    await expect(lightbox).toBeVisible({ timeout: 5000 })

    // Capture window.open() invocations so we can inspect the URL the
    // lightbox actually passes (without spawning a real new tab in
    // headless mode, which is unreliable).
    await page.evaluate(() => {
      ;(window as unknown as { __opens: string[] }).__opens = []
      const originalOpen = window.open
      window.open = (url?: string | URL, ...rest: unknown[]) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : ''
        ;(window as unknown as { __opens: string[] }).__opens.push(urlStr)
        return originalOpen.call(window, url, ...(rest as []))
      }
    })

    await lightbox.getByRole('button', { name: /Open original/i }).click()
    const opens = await page.evaluate(
      () => (window as unknown as { __opens: string[] }).__opens,
    )

    // The bug: clicking opened "" (empty) or "data:image/png;base64,..."
    // which Chrome blocks in a new tab (renders an empty page). Fix:
    // pass a blob: URL OR an http(s) URL that the browser will actually
    // load in a new tab.
    expect(opens.length).toBeGreaterThan(0)
    const url = opens[0]
    expect(url).not.toBe('')
    expect(url, 'data: URIs are blocked in new tabs by Chrome').not.toMatch(/^data:/)
    // Acceptable: blob:, http:, https:, /api/...
    expect(url).toMatch(/^(blob:|https?:|\/api\/)/)
  })
})
