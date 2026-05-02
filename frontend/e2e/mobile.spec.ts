import { test, expect } from '@playwright/test'

/**
 * Mobile responsive coverage (legacy file, refreshed).
 *
 * The original mobile.spec.ts was written before Build-8 #9 added the
 * sidebar-drawer pattern; it asserted UI that no longer exists ("Select
 * a conversation" empty state, sidebar-as-immediate-child, etc.).
 *
 * The authoritative mobile UX tests now live in `mobile-drawer.spec.ts`.
 * This file keeps a thin set of regression-style assertions that the
 * mobile viewport doesn't break basic page rendering.
 */

test.use({ viewport: { width: 375, height: 667 } })

test.describe('Mobile viewport — basic regression', () => {
  test('app shell renders on mobile (no fatal layout error)', async ({ page }) => {
    await page.goto('/')
    // Page title and Claude Explorer branding render somewhere in the DOM.
    // We don't assert visibility of the sidebar — it's drawer-hidden on
    // mobile per Build-8 #9, covered by mobile-drawer.spec.ts.
    await expect(page.locator('body')).toBeVisible()
    await expect(page).toHaveTitle(/Claude/i)
  })

  test('hamburger button is reachable on mobile', async ({ page }) => {
    await page.goto('/')
    // The drawer trigger uses an aria-label of "Open sidebar" (or "Menu").
    const hamburger = page.getByRole('button', { name: /open sidebar|menu/i })
    await expect(hamburger.first()).toBeVisible({ timeout: 10_000 })
  })

  test('main pane renders content on mobile (HintState or ConversationDetail)', async ({ page }) => {
    await page.goto('/')
    // Either the HintState ("Press Enter…") OR an actual conversation pane
    // is in the DOM. (mockBackend isn't in play here so we accept either
    // shape — this test is just a smoke check that the app shell mounts.)
    const hint = page.getByText(/Press\s+Enter\s+to open this conversation/i)
    const detail = page.locator('[data-testid="message-stream"]')
    const sawSomething = await Promise.race([
      hint.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false),
      detail.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false),
    ])
    expect(sawSomething).toBe(true)
  })
})
