import { test, expect, makeSummary, makeMessage, makeDetail, type Page } from './fixtures'

/**
 * Issue #4 — Markdown export bundle.
 *
 * The Settings page exposes two new controls:
 *
 *   - "Bundle images as a zip" toggle (default off)
 *   - "Markdown dialect" radio: CommonMark | Obsidian
 *
 * Both persist via localStorage. When the toggle is on, the
 * conversation header's "Markdown" button hits
 * /api/conversations/<uuid>/export/markdown-bundle?dialect=...
 * and saves a .zip; otherwise it falls back to the existing
 * single-file .md export.
 */

const ME = '00000000-0000-0000-0000-0000000000e7'

const summary = makeSummary({
  uuid: ME,
  name: 'Bundle export fixture',
  message_count: 1,
  source: 'CLAUDE_CODE',
})
const detail = makeDetail(summary, [
  makeMessage({ uuid: 'm1', sender: 'human', text: 'Hi', content: [{ type: 'text', text: 'Hi' }] }),
])

interface ExportCall {
  url: string
}

async function mockBundleAndPlainExports(page: Page, calls: ExportCall[]) {
  await page.route('**/api/conversations/**/export/markdown-bundle**', (route) => {
    calls.push({ url: route.request().url() })
    route.fulfill({
      status: 200,
      contentType: 'application/zip',
      headers: { 'content-disposition': 'attachment; filename="bundle.zip"' },
      body: Buffer.from('PK\x03\x04', 'binary'),
    })
  })
  await page.route('**/api/conversations/**/export/markdown**', (route) => {
    if (route.request().url().includes('markdown-bundle')) {
      // Already handled by the more-specific route above; let it
      // fall through.
      route.fallback()
      return
    }
    calls.push({ url: route.request().url() })
    route.fulfill({
      status: 200,
      contentType: 'text/markdown; charset=utf-8',
      body: '# Bundle export fixture\n\nHi',
    })
  })
}

test.describe('Markdown export bundle (Issue #4)', () => {
  test('Settings → toggle off → Markdown button hits the plain endpoint', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [ME]: detail } })
    const calls: ExportCall[] = []
    await mockBundleAndPlainExports(page, calls)

    await page.goto('/settings')
    // Default: bundle toggle should be OFF (unchecked).
    const toggle = page.getByTestId('settings-markdown-bundle-images')
    await expect(toggle).toBeVisible()
    await expect(toggle).not.toBeChecked()

    await page.goto(`/conversations/${ME}`)
    await page.getByRole('button', { name: 'Markdown', exact: true }).click()
    await page.waitForTimeout(200)

    expect(calls.length).toBeGreaterThan(0)
    const url = calls[calls.length - 1].url
    expect(url).toContain('/export/markdown')
    expect(url).not.toContain('markdown-bundle')
  })

  test('Settings → toggle on → Markdown button hits the bundle endpoint with the chosen dialect', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [ME]: detail } })
    const calls: ExportCall[] = []
    await mockBundleAndPlainExports(page, calls)

    await page.goto('/settings')
    const toggle = page.getByTestId('settings-markdown-bundle-images')
    await expect(toggle).toBeVisible()
    await toggle.check()

    // Switch to Obsidian dialect.
    await page.getByLabel('Obsidian').check()

    await page.goto(`/conversations/${ME}`)
    await page.getByRole('button', { name: 'Markdown', exact: true }).click()
    await page.waitForTimeout(200)

    expect(calls.length).toBeGreaterThan(0)
    const url = calls[calls.length - 1].url
    expect(url).toContain('/export/markdown-bundle')
    expect(url).toContain('dialect=obsidian')
  })

  test('Settings choices persist across reloads', async ({ page, mockBackend }) => {
    await mockBackend({ conversations: [summary], details: { [ME]: detail } })

    await page.goto('/settings')
    await page.getByTestId('settings-markdown-bundle-images').check()
    await page.getByLabel('Obsidian').check()

    // Reload the settings page; the toggle + radio must still be set.
    await page.reload()
    await expect(page.getByTestId('settings-markdown-bundle-images')).toBeChecked()
    await expect(page.getByLabel('Obsidian')).toBeChecked()
  })
})
