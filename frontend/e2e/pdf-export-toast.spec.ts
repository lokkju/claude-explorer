import { test, expect, makeSummary, makeMessage, makeDetail, type Page, withNetRetry, expectNetworkError } from './fixtures'

/**
 * Task A5 — Spinner toast UX for PDF export.
 *
 * The backend wraps WeasyPrint in asyncio.to_thread with a 30s timeout
 * and returns 504 on overrun (see backend/routers/export.py + commit
 * 0be9395). The frontend shows a spinner toast with an elapsed-time
 * counter during the export, disables the button while in flight, and
 * surfaces a user-readable error toast on 504/other failure.
 *
 * Spec contract (PLANS/2026.05.18-perf-polish.md, task A5):
 *   1. Spinner toast appears within ~200 ms of clicking the export button.
 *   2. Toast contains a spinner icon + "Generating PDF…" + elapsed seconds.
 *   3. Export button is disabled while the request is in flight.
 *   4. On success (200): toast dismisses; download triggers as today.
 *   5. On 504: error toast with user-readable timeout copy.
 *   6. No cancel button. No SSE. No progress bar.
 */

const PDF = '00000000-0000-0000-0000-0000000000a5'

const summary = makeSummary({
  uuid: PDF,
  name: 'PDF toast fixture',
  message_count: 1,
  source: 'CLAUDE_AI',
})

const messages = [
  makeMessage({
    uuid: 'pdf-m1',
    sender: 'human',
    text: 'hello',
    content: [{ type: 'text', text: 'hello' }],
  }),
]

const detail = makeDetail(summary, messages)

function minimalPdfBytes(): Buffer {
  // Smallest legal-ish PDF; matches the pattern used by exports.spec.ts.
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n', 'utf-8'),
    Buffer.from('%\xe2\xe3\xcf\xd3\n', 'binary'),
    Buffer.from('1 0 obj <<>> endobj\n%%EOF\n', 'utf-8'),
  ])
}

async function gotoConversation(page: Page) {
  await withNetRetry(() => page.goto(`/conversations/${PDF}`))
  await expect(page.locator('[data-message-uuid="pdf-m1"]')).toBeVisible()
}

async function clickPdfButton(page: Page) {
  // The header button labeled "PDF" — distinct from "Markdown".
  await page.getByRole('button', { name: /^PDF$/ }).click()
}

test.describe('PDF export spinner toast (Task A5)', () => {
  test('shows spinner toast with "Generating PDF" within 200ms of click', async ({
    page,
    mockBackend,
  }) => {
    await mockBackend({ conversations: [summary], details: { [PDF]: detail } })
    // Slow PDF response so we have time to observe the spinner.
    await page.route('**/api/conversations/*/export/pdf**', async (route) => {
      await new Promise((r) => setTimeout(r, 500))
      await route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        body: minimalPdfBytes(),
      })
    })
    await gotoConversation(page)

    const clickAt = Date.now()
    await clickPdfButton(page)

    // The 200 ms budget is for user-visible appearance, NOT Playwright
    // RPC round-trip. Sonner renders synchronously inside the click
    // handler, so the in-browser latency is well under 200ms; the
    // toBeVisible timeout is the load-bearing assertion. The wall-clock
    // delta below is a generous documentation bound; do NOT tighten it
    // below ~700ms without understanding Playwright RPC overhead.
    const toast = page.locator('[data-sonner-toast]').first()
    await expect(toast).toBeVisible({ timeout: 300 })
    const appearedAt = Date.now()
    expect(appearedAt - clickAt).toBeLessThan(700)
    await expect(toast).toContainText(/Generating PDF/i)
  })

  test('disables PDF export button while export is in flight', async ({
    page,
    mockBackend,
  }) => {
    await mockBackend({ conversations: [summary], details: { [PDF]: detail } })
    await page.route('**/api/conversations/*/export/pdf**', async (route) => {
      await new Promise((r) => setTimeout(r, 500))
      await route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        body: minimalPdfBytes(),
      })
    })
    await gotoConversation(page)

    const button = page.getByRole('button', { name: /^PDF$/ })
    await button.click()
    // Button must be disabled while the export request is in flight.
    await expect(button).toBeDisabled({ timeout: 300 })
  })

  test('504 timeout response shows user-readable error toast', async ({
    page,
    mockBackend,
    consoleAssertions,
  }) => {
    // §5.15: deliberate 504 → Chromium logs the network-layer line; the
    // app surfaces the user-readable toast separately.
    expectNetworkError(consoleAssertions, 504)
    await mockBackend({ conversations: [summary], details: { [PDF]: detail } })
    await page.route('**/api/conversations/*/export/pdf**', async (route) => {
      await route.fulfill({
        status: 504,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'PDF render timed out after 30s' }),
      })
    })
    await gotoConversation(page)
    await clickPdfButton(page)

    const errorToast = page.locator('[data-sonner-toast][data-type="error"]').first()
    await expect(errorToast).toBeVisible({ timeout: 5000 })
    // User-readable 504 copy per the spec: must mention timeout AND
    // point the user at Markdown as a workaround.
    await expect(errorToast).toContainText(/timed out/i)
    await expect(errorToast).toContainText(/Markdown/i)
  })

  test('successful PDF response dismisses spinner toast and triggers download', async ({
    page,
    mockBackend,
  }) => {
    await mockBackend({ conversations: [summary], details: { [PDF]: detail } })
    await page.route('**/api/conversations/*/export/pdf**', async (route) => {
      await new Promise((r) => setTimeout(r, 100))
      await route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        headers: { 'content-disposition': 'attachment; filename="PDF toast fixture.pdf"' },
        body: minimalPdfBytes(),
      })
    })
    await gotoConversation(page)

    const downloadPromise = page.waitForEvent('download', { timeout: 5000 })
    await clickPdfButton(page)

    const toast = page.locator('[data-sonner-toast]').first()
    await expect(toast).toBeVisible({ timeout: 300 })
    await expect(toast).toContainText(/Generating PDF/i)

    const download = await downloadPromise
    // The frontend names the file via sanitizeFilename(conversation.name),
    // not from Content-Disposition. We only assert the .pdf suffix.
    expect(download.suggestedFilename()).toMatch(/\.pdf$/)

    // Spinner toast must dismiss after success. Sonner may briefly keep
    // the DOM node around during exit animation; allow up to 2s.
    await expect(
      page.locator('[data-sonner-toast][data-type="loading"]'),
    ).toHaveCount(0, { timeout: 2000 })
  })
})
