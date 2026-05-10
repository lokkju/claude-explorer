import { test, expect } from './fixtures'

/**
 * V1 polish — Cmd+F must always switch the right-pane tab to "search",
 * NOT honor the persisted rightPaneTab preference.
 *
 * The bug: `rightPaneTab` is stored in server-side preferences (so a
 * user's last tab selection persists across reloads and tabs). If the
 * user ever clicked the Bookmarks tab, every subsequent Cmd+F would
 * open the panel showing Bookmarks — not what "find" muscle memory
 * expects.
 *
 * Fix: useKeyboardShortcuts.ts Cmd+F handler now calls
 * setRightPaneTab('search') before searchPanel.requestFocus().
 */

test('Cmd+F forces the right-pane tab to "search" regardless of persisted preference', async ({ page, mockBackend }) => {
  // Seed preferences with rightPaneTab=bookmarks so the page mounts
  // with Bookmarks as the active tab (mimics a user who clicked
  // Bookmarks at some point and never clicked back).
  await mockBackend({
    preferences: { rightPaneTab: 'bookmarks' },
  })

  await page.goto('/')

  // Open the panel via Cmd+K (so we can assert the initial tab state
  // BEFORE Cmd+F fires).
  await page.locator('main').click()
  await page.keyboard.press('Meta+k')
  const aside = page.locator('aside[aria-label="Search panel"]')
  await expect(aside).toBeVisible()

  // Bookmarks tab should be active per the seeded preference.
  const bookmarksTab = page.getByRole('tab', { name: /Bookmarks/ })
  await expect(bookmarksTab).toHaveAttribute('aria-selected', 'true')

  // Now Cmd+F: the panel was already open on Bookmarks, but Cmd+F is
  // "find" muscle memory and MUST switch to Search.
  await page.keyboard.press('Meta+f')

  const searchTab = page.getByRole('tab', { name: /Search/ })
  await expect(searchTab).toHaveAttribute('aria-selected', 'true')
  await expect(bookmarksTab).toHaveAttribute('aria-selected', 'false')

  // The search input should be focused (Cmd+F's other contract).
  const searchInput = page.locator('input[placeholder="Search messages..."]')
  await expect(searchInput).toBeFocused()
})


test('Cmd+F from a closed panel opens AND switches to search tab', async ({ page, mockBackend }) => {
  // Start with rightPaneTab=bookmarks AND panel closed.
  await mockBackend({
    preferences: { rightPaneTab: 'bookmarks', isOpen: false },
  })

  await page.goto('/')
  await page.locator('main').click()

  // Press Cmd+F. Even though rightPaneTab=bookmarks in prefs, the
  // panel must open with Search active.
  await page.keyboard.press('Meta+f')

  const aside = page.locator('aside[aria-label="Search panel"]')
  await expect(aside).toBeVisible()

  const searchTab = page.getByRole('tab', { name: /Search/ })
  await expect(searchTab).toHaveAttribute('aria-selected', 'true')

  const searchInput = page.locator('input[placeholder="Search messages..."]')
  await expect(searchInput).toBeFocused()
})
