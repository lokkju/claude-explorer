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
})
