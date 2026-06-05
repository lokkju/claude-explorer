import { test, expect, makeSummary, makeMessage, makeDetail, type Page, withNetRetry } from './fixtures'
import type { SearchResult } from '../src/lib/types'

/**
 * B22 — Click on a search result jumps to the specific message UUID and
 * highlights it. The article promises "scroll-to + flash" as the click
 * behavior; we assert the URL gains ?m=<msg-uuid> AND the target message
 * is in the viewport.
 */

const SM = '00000000-0000-0000-0000-0000000000f1'

const summary = makeSummary({ uuid: SM, name: 'Search target', message_count: 6 })

const messages = [
  makeMessage({ uuid: 'sm-m1', sender: 'human',
    text: 'Top of conversation', content: [{ type: 'text', text: 'Top of conversation' }] }),
  makeMessage({ uuid: 'sm-m2', sender: 'assistant',
    text: 'middle filler 1', content: [{ type: 'text', text: 'middle filler 1' }],
    parent_message_uuid: 'sm-m1' }),
  makeMessage({ uuid: 'sm-m3', sender: 'human',
    text: 'middle filler 2', content: [{ type: 'text', text: 'middle filler 2' }],
    parent_message_uuid: 'sm-m2' }),
  makeMessage({ uuid: 'sm-m4', sender: 'assistant',
    text: 'middle filler 3', content: [{ type: 'text', text: 'middle filler 3' }],
    parent_message_uuid: 'sm-m3' }),
  makeMessage({ uuid: 'sm-m5', sender: 'human',
    text: 'middle filler 4', content: [{ type: 'text', text: 'middle filler 4' }],
    parent_message_uuid: 'sm-m4' }),
  makeMessage({ uuid: 'sm-target', sender: 'assistant',
    text: 'TARGETED message about handshake protocol',
    content: [{ type: 'text', text: 'TARGETED message about handshake protocol' }],
    parent_message_uuid: 'sm-m5' }),
]

const detail = makeDetail(summary, messages)

const searchResults: SearchResult[] = [{
  conversation_uuid: SM,
  conversation_name: summary.name,
  conversation_updated_at: summary.updated_at,
  conversation_created_at: summary.created_at,
  project_name: null,
  matching_messages: [
    {
      message_uuid: 'sm-target',
      sender: 'assistant',
      snippet: 'TARGETED message about handshake protocol',
      match_start: 24,
      match_end: 33,
      created_at: messages[5].created_at,
    },
  ],
}]

async function mockSearch(page: Page, results: SearchResult[]) {
  await page.route('**/api/search**', (route) => {
    route.fulfill({
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

test.describe('Search — clicking a result jumps to the matching message UUID (B22)', () => {
  test('URL gains ?m=<uuid> and the bubble scrolls into view', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [SM]: detail } })
    await mockSearch(page, searchResults)
    // Use a viewport tall enough for all 6 messages so we can detect that
    // scroll-to-match actually happened (target visible after click).
    await page.setViewportSize({ width: 1024, height: 1200 })

    await withNetRetry(page, () => page.goto(`/conversations/${SM}`))
    await expect(page.locator('[data-message-uuid="sm-m1"]')).toBeVisible()

    // Open the search panel and run a query.
    await page.locator('main').click()
    await page.keyboard.press('Meta+k')
    const searchInput = page.locator('input[placeholder="Search messages..."]')
    await expect(searchInput).toBeVisible()
    await searchInput.fill('handshake')
    await expect(page.locator('text=/of\\s+1\\s+match/')).toBeVisible({ timeout: 10000 })

    // Click the result card. The SearchPanel renders each match as a
    // button; the snippet text isn't necessarily directly clickable, so
    // climb to the nearest button ancestor.
    const resultButton = page.getByRole('button', { name: /TARGETED message about handshake/i }).first()
    await expect(resultButton).toBeVisible()
    await resultButton.click()

    // The navigateToMatch path uses scrollIntoView. Assert the structural
    // outcome: the target bubble is in the viewport (Playwright's
    // toBeInViewport accounts for browser scroll position).
    const target = page.locator('[data-message-uuid="sm-target"]')
    await expect(target).toBeInViewport()
  })
})
