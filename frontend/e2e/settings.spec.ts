import { test, expect, withNetRetry } from './fixtures'

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page, mockBackend }) => {
    await mockBackend()
    await withNetRetry(() => page.goto('/'))
  })

  test('can navigate to settings page', async ({ page }) => {
    // Click the settings link in sidebar
    await page.click('a[href="/settings"]')

    // Should see settings page (use getByRole with name to be specific)
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.locator('text=Appearance')).toBeVisible()
    await expect(page.locator('text=Keyboard Navigation')).toBeVisible()
    // Data and About sections are below the fold - scroll to see them
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(page.getByRole('heading', { name: 'Data' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  })

  test('theme selection persists across page reload', async ({ page }) => {
    await withNetRetry(() => page.goto('/settings'))

    // Select dark mode
    await page.click('label:has-text("Dark")')

    // Reload the page
    await withNetRetry(() => page.reload())

    // Dark should still be selected (Radix UI uses button with role="radio" and data-state)
    const darkRadio = page.locator('button[role="radio"][value="dark"]')
    await expect(darkRadio).toHaveAttribute('data-state', 'checked')
  })

  test('keyboard mode selection persists', async ({ page }) => {
    await withNetRetry(() => page.goto('/settings'))

    // Select Vim mode
    await page.click('label:has-text("Vim")')

    // Reload the page
    await withNetRetry(() => page.reload())

    // Vim should still be selected (Radix UI uses button with role="radio" and data-state)
    const vimRadio = page.locator('button[role="radio"][value="vim"]')
    await expect(vimRadio).toHaveAttribute('data-state', 'checked')
  })

  test('displays data directory from config', async ({ page }) => {
    await withNetRetry(() => page.goto('/settings'))

    // Data section should show the directory from API
    await expect(page.locator('text=Data Directory')).toBeVisible()
    // Should show some path (mocked in tests)
    const dataSection = page.locator('section:has-text("Data")')
    await expect(dataSection).toBeVisible()
  })

  test('displays conversation count', async ({ page }) => {
    await withNetRetry(() => page.goto('/settings'))

    // Should show conversation count
    await expect(page.locator('text=Total Conversations')).toBeVisible()
  })

  // G2 audit — all three §16.1 preferences must coexist across a
  // single hard-reload. Individual prefs are covered by their own
  // specs, but those tests pass even if the persistence layer can only
  // carry ONE change at a time (a regression where each PATCH overwrites
  // the server blob would still let them pass individually). This test
  // toggles all three in the same session and asserts the post-reload
  // state shows all three.
  //
  // 2026-05-29 unification: the legacy `markdownBundleImages` +
  // `markdownDialect` pair was retired in favor of a single
  // `markdownExportMode` key shared with the Markdown export dialog.
  test('all three §16.1 preferences (theme, keyboard, markdownExportMode) persist together across reload', async ({
    page,
  }) => {
    await withNetRetry(() => page.goto('/settings'))

    const exportSection = page.locator('[data-section="markdown-export"]')
    await expect(exportSection).toBeVisible()

    // 1. Theme → Dark.
    const themePatch = page.waitForResponse(
      (r) => r.url().endsWith('/api/preferences') && r.request().method() === 'PATCH',
    )
    await page.locator('label:has-text("Dark")').click()
    await themePatch

    // 2. Keyboard → Vim.
    const keyboardPatch = page.waitForResponse(
      (r) => r.url().endsWith('/api/preferences') && r.request().method() === 'PATCH',
    )
    await page.locator('label:has-text("Vim")').click()
    await keyboardPatch

    // 3. Markdown export mode → Bundle Obsidian. Use .click() — the
    // controlled-component round trip (Radix onValueChange →
    // setMarkdownExportMode → mutation → re-render flips aria-checked)
    // races Playwright's .check() post-assertion under load.
    const modePatch = page.waitForResponse(
      (r) => r.url().endsWith('/api/preferences') && r.request().method() === 'PATCH',
    )
    await exportSection.getByRole('radio', { name: 'Bundle Obsidian' }).click()
    await modePatch

    // Hard reload — the persistence layer must serve all three prefs back.
    await withNetRetry(() => page.reload())

    // Theme: <html> still carries the `dark` class.
    await expect(page.locator('html')).toHaveClass(/dark/)
    // Keyboard mode: vim radio is checked.
    await expect(page.locator('button[role="radio"][value="vim"]')).toHaveAttribute(
      'data-state',
      'checked',
    )
    // Markdown export mode: Bundle Obsidian radio is checked.
    await expect(
      page
        .locator('[data-section="markdown-export"]')
        .getByRole('radio', { name: 'Bundle Obsidian' }),
    ).toBeChecked()
  })
})
