import { test, expect } from '@playwright/test'

test.describe('Toast position must not be occluded by the search panel', () => {
  test('toast remains visible when the right-side search panel is open', async ({ page }) => {
    await page.route('**/api/fetch/refresh*', async (route) => {
      const body =
        'data: {"type":"start","message":"Fetching conversation list..."}\n\n' +
        'data: {"type":"error","kind":"TRANSIENT","retryable":true,"message":"Network problem reaching claude.ai. Retry?"}\n\n'
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body,
      })
    })

    await page.goto('/')
    await page.keyboard.press('Meta+k')
    const searchPanel = page.locator('[data-testid="search-panel"], aside[aria-label*="earch"]').first()
    await page.waitForTimeout(300)

    const headerRefresh = page.locator('aside button[title="Refresh conversation list"]')
    await headerRefresh.click()

    const toast = page.locator('[data-sonner-toast]', {
      hasText: /Network problem reaching claude\.ai/i,
    })
    await expect(toast).toBeVisible({ timeout: 3000 })

    const toastBox = await toast.boundingBox()
    expect(toastBox).not.toBeNull()
    if (!toastBox) throw new Error('toast box missing')

    const viewport = page.viewportSize()
    if (!viewport) throw new Error('viewport missing')

    if (await searchPanel.isVisible().catch(() => false)) {
      const panelBox = await searchPanel.boundingBox()
      if (panelBox) {
        const overlapX =
          Math.max(0, Math.min(toastBox.x + toastBox.width, panelBox.x + panelBox.width) - Math.max(toastBox.x, panelBox.x))
        const overlapY =
          Math.max(0, Math.min(toastBox.y + toastBox.height, panelBox.y + panelBox.height) - Math.max(toastBox.y, panelBox.y))
        const overlapArea = overlapX * overlapY
        const toastArea = toastBox.width * toastBox.height
        expect(overlapArea / toastArea).toBeLessThan(0.25)
      }
    }
  })
})
