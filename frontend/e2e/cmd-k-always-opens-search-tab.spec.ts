import { test, expect, makeSummary, makeMessage, makeDetail, withNetRetry } from './fixtures'

/**
 * Regression test (2026-05-14, manual finding): Cmd+K was opening the
 * right-side panel on whichever tab was last active. If a user had
 * switched to the Bookmarks tab in a previous session (the choice is
 * persisted to preferences), pressing Cmd+K landed them on Bookmarks
 * instead of Search — directly contradicting Cmd+K's documented
 * promise of "open Search".
 *
 * Pairs with the existing Cmd+F fix in `keyboard-shortcuts.spec.ts`:
 *   - Cmd+F = "find / focus the search input": always Search tab
 *   - Cmd+K = "open the SearchPanel": also always Search tab when
 *     opening (toggle-close behavior preserved when already open)
 *
 * Test hooks used: ARIA role="tab" + aria-selected (no data-testid
 * needed; the tab elements are accessible-tree-correct).
 */

const C1 = '11111111-1111-1111-1111-111111111111'

const c1Summary = makeSummary({
  uuid: C1,
  name: 'Cmd+K tab regression fixture',
  source: 'CLAUDE_CODE',
})

const c1Detail = makeDetail(c1Summary, [
  makeMessage({
    uuid: 'c1-m1',
    sender: 'human',
    text: 'something to read while testing the tab switcher',
    content: [{ type: 'text', text: 'something to read while testing the tab switcher' }],
  }),
])

test.describe('Cmd+K always opens the Search tab (regression 2026-05-14)', () => {
  test('panel was on Bookmarks; Cmd+K reopens on Search', async ({
    page,
    mockBackend,
  }) => {
    await mockBackend({
      conversations: [c1Summary],
      details: { [C1]: c1Detail },
    })
    await withNetRetry(page, () => page.goto(`/conversations/${C1}`))
    await expect(page.locator('[data-message-uuid="c1-m1"]')).toBeVisible()

    const searchAside = page.locator('aside[aria-label="Search panel"]')
    const searchTab = page.getByRole('tab', { name: /search/i })
    const bookmarksTab = page.getByRole('tab', { name: /bookmarks/i })

    // Step 1: open the panel via Cmd+K so the tabs are mounted.
    await page.keyboard.press('Meta+k')
    await expect(searchAside).toHaveAttribute('aria-hidden', 'false')
    await expect(searchTab).toHaveAttribute('aria-selected', 'true')

    // Step 2: switch to the Bookmarks tab (simulating a user who left
    // their right pane on Bookmarks last session — that choice persists
    // via the preferences store).
    await bookmarksTab.click()
    await expect(bookmarksTab).toHaveAttribute('aria-selected', 'true')
    await expect(searchTab).toHaveAttribute('aria-selected', 'false')

    // Step 3: close the panel (Cmd+K toggles).
    await page.keyboard.press('Meta+k')
    await expect(searchAside).toHaveAttribute('aria-hidden', 'true')

    // Step 4: press Cmd+K again. THIS is the bug scenario — pre-fix,
    // the panel would reopen on Bookmarks (because the persisted
    // rightPaneTab was 'bookmarks'). Post-fix, Cmd+K force-sets the
    // tab to 'search' on open.
    await page.keyboard.press('Meta+k')
    await expect(searchAside).toHaveAttribute('aria-hidden', 'false')
    await expect(searchTab).toHaveAttribute('aria-selected', 'true')
    await expect(bookmarksTab).toHaveAttribute('aria-selected', 'false')
  })

  test('Cmd+K from closed panel always opens on Search (single press)', async ({
    page,
    mockBackend,
  }) => {
    // Bidirectional: simpler case — panel is closed and the last-
    // selected tab was Bookmarks. One Cmd+K must open on Search.
    await mockBackend({
      conversations: [c1Summary],
      details: { [C1]: c1Detail },
      preferences: { rightPaneTab: 'bookmarks' },
    })
    await withNetRetry(page, () => page.goto(`/conversations/${C1}`))
    await expect(page.locator('[data-message-uuid="c1-m1"]')).toBeVisible()

    const searchAside = page.locator('aside[aria-label="Search panel"]')
    const searchTab = page.getByRole('tab', { name: /search/i })

    await page.keyboard.press('Meta+k')
    await expect(searchAside).toHaveAttribute('aria-hidden', 'false')
    await expect(searchTab).toHaveAttribute('aria-selected', 'true')
  })

  test('Cmd+K toggle-close still works when already on Search', async ({
    page,
    mockBackend,
  }) => {
    // Regression guard: my fix mustn't break Cmd+K's toggle behavior
    // when the panel is already open on the Search tab. Cmd+K closes it.
    await mockBackend({
      conversations: [c1Summary],
      details: { [C1]: c1Detail },
    })
    await withNetRetry(page, () => page.goto(`/conversations/${C1}`))
    await expect(page.locator('[data-message-uuid="c1-m1"]')).toBeVisible()

    const searchAside = page.locator('aside[aria-label="Search panel"]')
    const searchTab = page.getByRole('tab', { name: /search/i })

    await page.keyboard.press('Meta+k')
    await expect(searchAside).toHaveAttribute('aria-hidden', 'false')
    await expect(searchTab).toHaveAttribute('aria-selected', 'true')

    // Second Cmd+K closes (panel was open on Search → toggle).
    await page.keyboard.press('Meta+k')
    await expect(searchAside).toHaveAttribute('aria-hidden', 'true')
  })
})
