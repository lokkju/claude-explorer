import { test, expect } from '@playwright/test'

test.describe('Header Refresh button (Sidebar)', () => {
  test('clicking the header Refresh button hits the /api/fetch/refresh SSE pipeline', async ({ page }) => {
    const refreshRequests: string[] = []
    page.on('request', (req) => {
      const url = req.url()
      if (url.includes('/api/fetch/refresh')) {
        refreshRequests.push(url)
      }
    })

    await page.route('**/api/fetch/refresh*', async (route) => {
      const body =
        'data: {"type":"start","message":"Fetching conversation list..."}\n\n' +
        'data: {"type":"complete","message":"Fetched 0 conversations successfully.","current":0,"total":0}\n\n'
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body,
      })
    })

    await page.goto('/')
    const headerRefresh = page.locator('aside button[title="Refresh conversation list"]')
    await expect(headerRefresh).toBeVisible()
    await headerRefresh.click()
    await page.waitForTimeout(500)

    expect(refreshRequests.length).toBeGreaterThan(0)
    expect(refreshRequests[0]).toContain('/api/fetch/refresh')
  })

  test('clicking the header Refresh button shows an error toast for at least 5 seconds when the SSE errors', async ({ page }) => {
    await page.route('**/api/fetch/refresh*', async (route) => {
      const body =
        'data: {"type":"start","message":"Fetching conversation list..."}\n\n' +
        'data: {"type":"error","message":"Network problem reaching claude.ai. Retry?","kind":"TRANSIENT","retryable":true}\n\n'
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body,
      })
    })

    await page.goto('/')
    const headerRefresh = page.locator('aside button[title="Refresh conversation list"]')
    await headerRefresh.click()

    const toast = page.locator('[data-sonner-toast]', {
      hasText: /Network problem reaching claude\.ai/i,
    })
    await expect(toast).toBeVisible({ timeout: 3000 })

    await page.waitForTimeout(5000)
    await expect(toast).toBeVisible()
  })
})
