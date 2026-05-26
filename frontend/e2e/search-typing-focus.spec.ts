import { test, expect, makeSummary, makeMessage, makeDetail, type Page, type Route } from './fixtures'
import type { Message } from '../src/lib/types'

/**
 * UX contract: when search results arrive after the user types, the
 * conversation pane auto-promotes to the first match (scrolls + flashes
 * yellow ring), BUT keyboard focus STAYS in the search input. The user
 * is still typing — moving DOM focus mid-keystroke is the bug that
 * prompted this work.
 *
 * Separately: Cmd+G / Cmd+Shift+G / Enter / click-on-card MUST move
 * focus to the target bubble (so Cmd+C copies the message). Those
 * paths are covered by search-focus-model.spec.ts; this file covers
 * ONLY the typing/auto-promote path.
 *
 * Design provenance: 2026-05-23 council decision (continuation of
 * a6307304c09e749c2). User answered all 4 gates:
 *   - GATE 1: auto-navigate cross-conv WITHOUT focus steal.
 *   - GATE 2: provenance flag `'auto' | 'user'` on activeMatchIndex.
 *   - GATE 3: every results-arrival re-promotes index 0 (live preview).
 *   - GATE 4: Cmd+G MOVES focus to bubble (pinned by search-focus-model).
 */

const A = '00000000-0000-0000-0000-000000ff1100'
const B = '00000000-0000-0000-0000-000000ff2200'

const summaryA = makeSummary({
  uuid: A,
  source: 'CLAUDE_CODE',
  message_count: 2,
  project_path: '/work/projectX',
  project_name: 'projectX',
  name: 'Conv A — fixture',
})

const summaryB = makeSummary({
  uuid: B,
  source: 'CLAUDE_CODE',
  message_count: 1,
  project_path: '/work/projectX',
  project_name: 'projectX',
  name: 'Conv B — fixture',
})

const aMsg1 = makeMessage({
  uuid: 'a-msg-1',
  sender: 'human',
  text: 'first needle message in A',
  content: [{ type: 'text', text: 'first needle message in A' }],
} as Partial<Message> & { uuid: string })
const aMsg2 = makeMessage({
  uuid: 'a-msg-2',
  sender: 'assistant',
  text: 'second response in A',
  content: [{ type: 'text', text: 'second response in A' }],
} as Partial<Message> & { uuid: string })
const bMsg1 = makeMessage({
  uuid: 'b-msg-1',
  sender: 'assistant',
  text: 'unique haystack token: zebra-quark',
  content: [{ type: 'text', text: 'unique haystack token: zebra-quark' }],
} as Partial<Message> & { uuid: string })

const detailA = makeDetail(summaryA, [aMsg1, aMsg2])
const detailB = makeDetail(summaryB, [bMsg1])

/**
 * Search mock that mirrors the query against fixed payloads. Adds a
 * 50ms artificial delay so React Query's debounce + AbortSignal logic
 * actually exercises (instantaneous responses can mask race bugs).
 */
async function mockSearch(page: Page) {
  await page.route('**/api/search**', async (route: Route) => {
    const url = new URL(route.request().url())
    const q = (url.searchParams.get('q') ?? '').toLowerCase()
    let results: unknown[] = []
    if (q.includes('needle')) {
      results = [
        {
          conversation_uuid: A,
          conversation_name: summaryA.name,
          conversation_updated_at: summaryA.updated_at,
          conversation_created_at: summaryA.created_at,
          project_name: 'projectX',
          matching_messages: [
            {
              message_uuid: 'a-msg-1',
              sender: 'human',
              snippet: 'first needle message in A',
              match_start: 6,
              match_end: 12,
              created_at: aMsg1.created_at,
            },
          ],
        },
      ]
    } else if (q.includes('zebra')) {
      results = [
        {
          conversation_uuid: B,
          conversation_name: summaryB.name,
          conversation_updated_at: summaryB.updated_at,
          conversation_created_at: summaryB.created_at,
          project_name: 'projectX',
          matching_messages: [
            {
              message_uuid: 'b-msg-1',
              sender: 'assistant',
              snippet: 'unique haystack token: zebra-quark',
              match_start: 23,
              match_end: 28,
              created_at: bMsg1.created_at,
            },
          ],
        },
      ]
    }
    await new Promise((r) => setTimeout(r, 50))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results,
        total_messages_matched: results.length,
        returned_messages: results.length,
        truncated: false,
      }),
    })
  })
}

async function openPanel(page: Page) {
  const isMac = process.platform === 'darwin'
  await page.keyboard.press(isMac ? 'Meta+f' : 'Control+f')
  const input = page.getByPlaceholder('Search messages...')
  await expect(input).toBeVisible({ timeout: 3000 })
  return input
}

test.describe('Search — typing keeps focus in input (2026-05-23 design)', () => {
  test('same-conv: results arrival applies ring AND leaves focus in input', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations: [summaryA, summaryB],
      details: { [A]: detailA, [B]: detailB },
    })
    await mockSearch(page)
    await page.goto(`/conversations/${A}`)
    await expect(page.locator('[data-message-uuid="a-msg-1"]')).toBeVisible()

    const input = await openPanel(page)
    await input.click()
    await input.fill('needle')

    // Results land — sidebar shows 1 match.
    await expect(page.getByText(/of\s+1\s+match/)).toBeVisible({ timeout: 5000 })

    // The bubble in conv A gets the yellow ring (auto-promote ran).
    const bubble = page.locator('[data-message-uuid="a-msg-1"]')
    await expect(bubble).toBeVisible()
    await expect(bubble).toHaveClass(/ring-yellow-400/, { timeout: 5000 })

    // CRITICAL: focus must REMAIN in the search input. The auto-promote
    // path must not steal focus mid-typing.
    await expect(input).toBeFocused()

    // The bubble must NOT be the active element either (negative pair).
    const bubbleIsFocused = await page.evaluate(() => {
      const el = document.querySelector('[data-message-uuid="a-msg-1"]')
      return el === document.activeElement
    })
    expect(bubbleIsFocused).toBe(false)
  })

  test('keystrokes after results-arrival continue to route to the search input', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations: [summaryA, summaryB],
      details: { [A]: detailA, [B]: detailB },
    })
    await mockSearch(page)
    await page.goto(`/conversations/${A}`)
    const input = await openPanel(page)
    await input.click()
    await input.fill('needle')
    await expect(page.getByText(/of\s+1\s+match/)).toBeVisible({ timeout: 5000 })
    await expect(input).toBeFocused()

    // Type an additional character — must end up in the input. If focus
    // moved to the bubble, the keystroke would go to the bubble's
    // tabIndex=-1 div (no-op) and input value wouldn't change.
    await page.keyboard.type('x')
    await expect(input).toHaveValue('needlex')
    await expect(input).toBeFocused()
  })

  test('cross-conv: auto-navigates to the other conv AND keeps focus in input', async ({ page, mockBackend }) => {
    // Start on conv A; type a query that only hits in conv B.
    // The auto-promote should navigate the route to /conversations/B,
    // mount b-msg-1, apply the ring, but NOT focus the bubble.
    await mockBackend({
      conversations: [summaryA, summaryB],
      details: { [A]: detailA, [B]: detailB },
    })
    await mockSearch(page)
    await page.goto(`/conversations/${A}`)
    await expect(page.locator('[data-message-uuid="a-msg-1"]')).toBeVisible()

    const input = await openPanel(page)
    await input.click()
    await input.fill('zebra')
    await expect(page.getByText(/of\s+1\s+match/)).toBeVisible({ timeout: 5000 })

    // URL switched to conv B.
    await expect(page).toHaveURL(new RegExp(`/conversations/${B}`), { timeout: 5000 })
    const bubble = page.locator('[data-message-uuid="b-msg-1"]')
    await expect(bubble).toBeVisible({ timeout: 5000 })
    await expect(bubble).toHaveClass(/ring-yellow-400/, { timeout: 5000 })

    // CRITICAL: focus still in input. The cross-conv URL fallback path
    // currently fires element.focus() in ConversationPage's highlight
    // effect; the new design appends &focus=0 to the URL so that
    // .focus() call is skipped for the auto path.
    await expect(input).toBeFocused({ timeout: 2000 })
  })

  test('Cmd+G moves DOM focus to the bubble (user path)', async ({ page, mockBackend }) => {
    // Counter-test for the auto path: confirm user-initiated nav DOES
    // take focus. This is the contract Cmd+C depends on.
    await mockBackend({
      conversations: [summaryA, summaryB],
      details: { [A]: detailA, [B]: detailB },
    })
    await mockSearch(page)
    await page.goto(`/conversations/${A}`)
    const input = await openPanel(page)
    await input.click()
    await input.fill('needle')
    await expect(page.getByText(/of\s+1\s+match/)).toBeVisible({ timeout: 5000 })
    await expect(input).toBeFocused()

    const isMac = process.platform === 'darwin'
    await page.keyboard.press(isMac ? 'Meta+g' : 'Control+g')

    // After Cmd+G, the bubble must be the focused element. Pressing
    // Cmd+C should then copy the bubble (other tests cover the actual
    // copy; here we pin focus transfer).
    const bubble = page.locator('[data-message-uuid="a-msg-1"]')
    await expect(bubble).toBeFocused({ timeout: 2000 })
  })
})
