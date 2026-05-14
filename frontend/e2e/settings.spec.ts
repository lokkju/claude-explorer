import { test, expect } from './fixtures'

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page, mockBackend }) => {
    await mockBackend()
    await page.goto('/')
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
    await page.goto('/settings')

    // Select dark mode
    await page.click('label:has-text("Dark")')

    // Reload the page
    await page.reload()

    // Dark should still be selected (Radix UI uses button with role="radio" and data-state)
    const darkRadio = page.locator('button[role="radio"][value="dark"]')
    await expect(darkRadio).toHaveAttribute('data-state', 'checked')
  })

  test('keyboard mode selection persists', async ({ page }) => {
    await page.goto('/settings')

    // Select Vim mode
    await page.click('label:has-text("Vim")')

    // Reload the page
    await page.reload()

    // Vim should still be selected (Radix UI uses button with role="radio" and data-state)
    const vimRadio = page.locator('button[role="radio"][value="vim"]')
    await expect(vimRadio).toHaveAttribute('data-state', 'checked')
  })

  test('displays data directory from config', async ({ page }) => {
    await page.goto('/settings')

    // Data section should show the directory from API
    await expect(page.locator('text=Data Directory')).toBeVisible()
    // Should show some path (mocked in tests)
    const dataSection = page.locator('section:has-text("Data")')
    await expect(dataSection).toBeVisible()
  })

  test('displays conversation count', async ({ page }) => {
    await page.goto('/settings')

    // Should show conversation count
    await expect(page.locator('text=Total Conversations')).toBeVisible()
  })

  // G2 audit — all four §16.1 preferences must coexist across a single
  // hard-reload. Individual prefs are covered by their own specs, but
  // those tests pass even if the persistence layer can only carry ONE
  // change at a time (a regression where each PATCH overwrites the
  // server blob would still let them pass individually). This test
  // toggles all four in the same session and asserts the post-reload
  // state shows all four.
  test('all four §16.1 preferences (theme, keyboard, bundle-images, dialect) persist together across reload', async ({
    page,
  }) => {
    await page.goto('/settings')

    // Wait for the page to mount fully (toggle visible + enabled). The
    // shared mock /api/preferences in fixtures.ts is stateful within a
    // single page context, so PATCH bodies merge into the same blob and
    // a subsequent reload reads them all back.
    const bundleToggle = page.getByTestId('settings-markdown-bundle-images')
    await expect(bundleToggle).toBeVisible()

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

    // 3. Bundle images → checked.
    const bundlePatch = page.waitForResponse(
      (r) => r.url().endsWith('/api/preferences') && r.request().method() === 'PATCH',
    )
    await bundleToggle.click()
    await bundlePatch
    await expect(bundleToggle).toBeChecked()

    // 4. Dialect → Obsidian.
    const dialectPatch = page.waitForResponse(
      (r) => r.url().endsWith('/api/preferences') && r.request().method() === 'PATCH',
    )
    await page.locator('label:has-text("Obsidian")').click()
    await dialectPatch

    // Hard reload — the persistence layer must serve ALL four prefs back.
    await page.reload()

    // Theme: <html> still carries the `dark` class.
    await expect(page.locator('html')).toHaveClass(/dark/)
    // Keyboard mode: vim radio is checked.
    await expect(page.locator('button[role="radio"][value="vim"]')).toHaveAttribute(
      'data-state',
      'checked',
    )
    // Bundle images: checkbox stays on.
    await expect(page.getByTestId('settings-markdown-bundle-images')).toBeChecked()
    // Dialect: obsidian radio is checked.
    await expect(page.locator('button[role="radio"][value="obsidian"]')).toHaveAttribute(
      'data-state',
      'checked',
    )
  })
})
