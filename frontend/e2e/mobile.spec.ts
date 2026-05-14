import { test, expect } from './fixtures'

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
 *
 * M5.5: converted to the shared `./fixtures` `mockBackend` so the suite
 * runs Python-free (no live backend on :8765 → ConnectionStatus modal
 * would otherwise intercept pointer events on the hamburger).
 */

test.use({ viewport: { width: 375, height: 667 } })

test.describe('Mobile viewport — basic regression', () => {
  test('app shell renders on mobile (no fatal layout error)', async ({ page, mockBackend }) => {
    await mockBackend({})
    await page.goto('/')
    // Page title and Claude Explorer branding render somewhere in the DOM.
    // We don't assert visibility of the sidebar — it's drawer-hidden on
    // mobile per Build-8 #9, covered by mobile-drawer.spec.ts.
    await expect(page.locator('body')).toBeVisible()
    await expect(page).toHaveTitle(/Claude/i)
  })

  test('hamburger button is reachable on mobile', async ({ page, mockBackend }) => {
    await mockBackend({})
    await page.goto('/')
    // The drawer trigger uses an aria-label of "Open sidebar" (or "Menu").
    const hamburger = page.getByRole('button', { name: /open sidebar|menu/i })
    await expect(hamburger.first()).toBeVisible({ timeout: 10_000 })
  })

  test('main pane renders content on mobile (HintState or ConversationDetail)', async ({ page, mockBackend }) => {
    await mockBackend({})
    await page.goto('/')
    // Either the HintState ("Press Enter…") OR an actual conversation pane
    // is in the DOM. With an empty mocked backend the app mounts the empty
    // HintState; this test is a smoke check that the shell mounts at all.
    const hint = page.getByText(/Press\s+Enter\s+to open this conversation/i)
    const detail = page.locator('[data-testid="message-stream"]')
    const sawSomething = await Promise.race([
      hint.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false),
      detail.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false),
    ])
    expect(sawSomething).toBe(true)
  })
})
