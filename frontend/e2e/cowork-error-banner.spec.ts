import { test, expect, makeSummary, makeMessage, makeDetail } from './fixtures'

/**
 * D9 — Cowork session-error banner.
 *
 * Pins:
 *  - When the Cowork sidecar carried `error: <string>`, the detail
 *    view renders an alert banner above the message stream with the
 *    error text.
 *  - Inverse: a clean Cowork session (error=null) shows NO banner.
 */

const ERROR_UUID = 'eebb1111-2222-3333-4444-555566660001'
const CLEAN_UUID = 'eebb1111-2222-3333-4444-555566660002'
const ERROR_TEXT = 'The session ended unexpectedly.'

const erroredSummary = makeSummary({
  uuid: ERROR_UUID,
  name: 'Cowork With Error',
  source: 'CLAUDE_COWORK',
})

const cleanSummary = makeSummary({
  uuid: CLEAN_UUID,
  name: 'Cowork Clean',
  source: 'CLAUDE_COWORK',
})

const userMsg = makeMessage({
  uuid: 'm1',
  sender: 'human',
  text: 'hello',
  content: [{ type: 'text', text: 'hello' }],
})

const erroredDetail = makeDetail(erroredSummary, [userMsg], {
  error: ERROR_TEXT,
})

const cleanDetail = makeDetail(cleanSummary, [userMsg], {
  error: null,
})

test.describe('Cowork D9 — error banner', () => {
  test('renders banner with error text when sidecar.error is set', async ({
    page,
    mockBackend,
  }) => {
    await mockBackend({
      conversations: [erroredSummary],
      details: { [ERROR_UUID]: erroredDetail },
    })

    await page.goto(`/conversations/${ERROR_UUID}`)
    await expect(page.getByTestId('message-stream')).toBeVisible()

    const banner = page.getByTestId('cowork-error-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText(ERROR_TEXT)
  })

  test('no banner when error is null', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations: [cleanSummary],
      details: { [CLEAN_UUID]: cleanDetail },
    })

    await page.goto(`/conversations/${CLEAN_UUID}`)
    await expect(page.getByTestId('message-stream')).toBeVisible()

    // Bidirectional: banner explicitly absent.
    await expect(page.getByTestId('cowork-error-banner')).toHaveCount(0)
  })
})
