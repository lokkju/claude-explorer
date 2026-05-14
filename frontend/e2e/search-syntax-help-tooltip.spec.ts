import { test, expect, makeSummary, makeMessage, makeDetail } from './fixtures'

/**
 * 2026-05-14 polish: the SearchPanel's right-sidebar input now has a
 * small `?` icon that, on hover or keyboard focus, surfaces a tooltip
 * explaining the AND-of-terms vs quoted-phrase query syntax. This
 * spec pins the affordance + its content so a future refactor that
 * accidentally drops the tooltip is caught by CI.
 */

const C1 = '11111111-1111-1111-1111-111111111111'

const c1Summary = makeSummary({
  uuid: C1,
  name: 'Search syntax tooltip fixture',
  source: 'CLAUDE_CODE',
})

const c1Detail = makeDetail(c1Summary, [
  makeMessage({
    uuid: 'c1-m1',
    sender: 'human',
    text: 'something to read while testing the tooltip',
    content: [{ type: 'text', text: 'something to read while testing the tooltip' }],
  }),
])

test.describe('Search syntax help tooltip (2026-05-14)', () => {
  test('? icon next to search input shows the AND-of-terms / phrase tooltip on hover', async ({
    page,
    mockBackend,
  }) => {
    await mockBackend({
      conversations: [c1Summary],
      details: { [C1]: c1Detail },
    })
    await page.goto(`/conversations/${C1}`)
    await expect(page.locator('[data-message-uuid="c1-m1"]')).toBeVisible()

    // Open the SearchPanel.
    await page.keyboard.press('Meta+k')
    await expect(page.locator('aside[aria-label="Search panel"]')).toHaveAttribute('aria-hidden', 'false')

    // The help icon is present and accessible.
    const helpButton = page.getByTestId('search-syntax-help')
    await expect(helpButton).toBeVisible()
    await expect(helpButton).toHaveAttribute('aria-label', 'Search query syntax help')

    // Hover the icon and wait for the Radix tooltip to open. Radix
    // emits role="tooltip" on the content, so we locate by role +
    // text rather than CSS specifics. `toBeVisible` polls past the
    // 150ms `delayDuration` automatically.
    await helpButton.hover()
    const tooltip = page.getByRole('tooltip').filter({ hasText: /search syntax/i })
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText(/all words must appear in the same message/i)
    await expect(tooltip).toContainText(/double quotes/i)
    await expect(tooltip).toContainText(/exact phrase/i)
  })

  test('? icon is keyboard-reachable via Tab from the search input', async ({
    page,
    mockBackend,
  }) => {
    // Bidirectional accessibility check: keyboard users can reach the
    // help button. We deliberately don't assert tooltip-opens-on-focus
    // here because Radix's open-on-programmatic-focus is non-
    // deterministic in headless Chromium (the hover test above covers
    // the open semantics). What matters for accessibility is the
    // button is reachable, focusable, and exposes the right
    // aria-label so screen readers describe it correctly.
    await mockBackend({
      conversations: [c1Summary],
      details: { [C1]: c1Detail },
    })
    await page.goto(`/conversations/${C1}`)
    await expect(page.locator('[data-message-uuid="c1-m1"]')).toBeVisible()

    await page.keyboard.press('Meta+k')
    await expect(page.locator('aside[aria-label="Search panel"]')).toHaveAttribute('aria-hidden', 'false')

    const searchInput = page.locator('input[placeholder="Search messages..."]')
    await expect(searchInput).toBeFocused()

    // Tab from the search input lands on the help button (Cmd+K
    // focuses the input on open; the help button is the next tab stop).
    await page.keyboard.press('Tab')
    const helpButton = page.getByTestId('search-syntax-help')
    await expect(helpButton).toBeFocused()
  })
})
