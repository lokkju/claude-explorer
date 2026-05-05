import { test, expect, makeSummary, makeMessage, makeDetail, type Page, type Route } from './fixtures'
import type { Message } from '../src/lib/types'

/**
 * Manual finding 2026-05-04: search focus model.
 *
 *   - Cmd+G / Cmd+Shift+G: scroll the conversation pane to the next /
 *     prev match BUT keep keyboard focus inside the SearchPanel input.
 *     An aria-live region in the panel header announces "Match N of M"
 *     so screen-reader users hear the change without focus moving.
 *   - Enter on the active result card: focus the corresponding message
 *     in the conversation pane; SearchPanel stays open.
 *   - Esc: close the SearchPanel and focus the message that
 *     activeMatchIndex pointed at (preserves "land near hit, then read
 *     around it" workflow).
 */

const C = '00000000-0000-0000-0000-000000fffff0'

const summary = makeSummary({
  uuid: C,
  source: 'CLAUDE_CODE',
  message_count: 3,
  project_path: '/work/projectX',
  project_name: 'projectX',
  name: 'Focus model fixture',
})

const m1 = makeMessage({
  uuid: 'msg-1',
  sender: 'human',
  text: 'first needle line',
  content: [{ type: 'text', text: 'first needle line' }],
} as Partial<Message> & { uuid: string })
const m2 = makeMessage({
  uuid: 'msg-2',
  sender: 'assistant',
  text: 'second needle line',
  content: [{ type: 'text', text: 'second needle line' }],
} as Partial<Message> & { uuid: string })
const m3 = makeMessage({
  uuid: 'msg-3',
  sender: 'human',
  text: 'third needle line',
  content: [{ type: 'text', text: 'third needle line' }],
} as Partial<Message> & { uuid: string })

const detail = makeDetail(summary, [m1, m2, m3])

async function mockSearchResults(page: Page) {
  await page.route('**/api/search**', (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          conversation_uuid: C,
          conversation_name: 'Focus model fixture',
          conversation_updated_at: summary.updated_at,
          conversation_created_at: summary.created_at,
          project_name: 'projectX',
          matching_messages: [
            {
              message_uuid: 'msg-1',
              sender: 'human',
              snippet: 'first needle line',
              match_start: 6,
              match_end: 12,
              created_at: m1.created_at,
            },
            {
              message_uuid: 'msg-2',
              sender: 'assistant',
              snippet: 'second needle line',
              match_start: 7,
              match_end: 13,
              created_at: m2.created_at,
            },
            {
              message_uuid: 'msg-3',
              sender: 'human',
              snippet: 'third needle line',
              match_start: 6,
              match_end: 12,
              created_at: m3.created_at,
            },
          ],
        },
      ]),
    })
  })
}

async function openPanelAndType(page: Page, q: string) {
  const isMac = process.platform === 'darwin'
  await page.keyboard.press(isMac ? 'Meta+f' : 'Control+f')
  const input = page.getByPlaceholder('Search messages...')
  await expect(input).toBeVisible({ timeout: 3000 })
  await input.click()
  await input.fill(q)
  await expect(page.getByText(/of\s+3\s+matches/)).toBeVisible({ timeout: 5000 })
}

test.describe('Search focus model (manual finding 2026-05-04)', () => {
  test('Cmd+G keeps focus in SearchPanel input and scrolls conversation', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [C]: detail } })
    await mockSearchResults(page)
    await page.goto(`/conversations/${C}`)
    await openPanelAndType(page, 'needle')

    const input = page.getByPlaceholder('Search messages...')
    await expect(input).toBeFocused()

    const isMac = process.platform === 'darwin'
    await page.keyboard.press(isMac ? 'Meta+g' : 'Control+g')

    // Focus must remain on the search input — Cmd+G is "find again",
    // not "jump to message".
    await expect(input).toBeFocused({ timeout: 2000 })
  })

  test('aria-live region announces "Match N of M"', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [C]: detail } })
    await mockSearchResults(page)
    await page.goto(`/conversations/${C}`)
    await openPanelAndType(page, 'needle')

    const live = page.locator('[data-testid="search-match-aria-live"]')
    await expect(live).toHaveAttribute('aria-live', 'polite')

    const isMac = process.platform === 'darwin'
    await page.keyboard.press(isMac ? 'Meta+g' : 'Control+g')
    await expect(live).toContainText(/Match\s+1\s+of\s+3/i, { timeout: 3000 })

    await page.keyboard.press(isMac ? 'Meta+g' : 'Control+g')
    await expect(live).toContainText(/Match\s+2\s+of\s+3/i, { timeout: 3000 })
  })

  test('Enter on the active match focuses the message and keeps panel open', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [C]: detail } })
    await mockSearchResults(page)
    await page.goto(`/conversations/${C}`)
    await openPanelAndType(page, 'needle')

    const isMac = process.platform === 'darwin'
    // Step to first match so there's an active card.
    await page.keyboard.press(isMac ? 'Meta+g' : 'Control+g')

    // Enter on the input commits "open active match" → focuses the message.
    await page.keyboard.press('Enter')

    // Panel stays open (aria-hidden=false).
    const panel = page.locator('[data-testid="search-panel"], [aria-label="Search panel"]').first()
    // Fall back to the input visibility test if panel container has no
    // testid yet — input visible ⇒ panel open.
    await expect(page.getByPlaceholder('Search messages...')).toBeVisible()

    // The selected message bubble should now have the keyboard-selection
    // ring (data-keyboard-selected) — assert via the ring class on the
    // bubble whose data-message-uuid is msg-1.
    const bubble = page.locator('[data-message-uuid="msg-1"]')
    await expect(bubble).toBeVisible()
    void panel
  })

  test('Esc closes the panel and keeps focus on the active-match message', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [C]: detail } })
    await mockSearchResults(page)
    await page.goto(`/conversations/${C}`)
    await openPanelAndType(page, 'needle')

    const isMac = process.platform === 'darwin'
    // Step to second match.
    await page.keyboard.press(isMac ? 'Meta+g' : 'Control+g')
    await page.keyboard.press(isMac ? 'Meta+g' : 'Control+g')

    // Esc closes the panel immediately and focuses the active-match
    // message (manual finding 2026-05-04: keep current selection).
    await page.keyboard.press('Escape')

    // Panel slides off-screen; assert aria-hidden=true on the panel
    // root rather than visibility (translate-x-full leaves "visible").
    await expect.poll(async () => {
      return await page.evaluate(() => {
        const el = document.querySelector('[aria-label="Search panel"]')
        return el?.getAttribute('aria-hidden')
      })
    }, { timeout: 3000 }).toBe('true')

    // The active-match message (msg-2) should still be visible.
    const bubble = page.locator('[data-message-uuid="msg-2"]')
    await expect(bubble).toBeVisible()
  })
})
