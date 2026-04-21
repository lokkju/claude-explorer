import { test, expect } from '@playwright/test'

test.describe('Theme Functionality', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage before each test
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
  })

  test('defaults to system theme', async ({ page }) => {
    await page.goto('/settings')

    // System should be selected by default (Radix UI uses button with role="radio" and data-state)
    const systemRadio = page.locator('button[role="radio"][value="system"]')
    await expect(systemRadio).toHaveAttribute('data-state', 'checked')
  })

  test('applies dark class when dark mode is selected', async ({ page }) => {
    await page.goto('/settings')

    // Select dark mode
    await page.click('label:has-text("Dark")')

    // HTML element should have dark class
    const htmlElement = page.locator('html')
    await expect(htmlElement).toHaveClass(/dark/)
  })

  test('removes dark class when light mode is selected', async ({ page }) => {
    // First set dark mode
    await page.goto('/settings')
    await page.click('label:has-text("Dark")')

    // Then switch to light mode
    await page.click('label:has-text("Light")')

    // HTML element should not have dark class
    const htmlElement = page.locator('html')
    await expect(htmlElement).not.toHaveClass(/dark/)
  })

  test('theme toggle button cycles through themes', async ({ page }) => {
    await page.goto('/')

    // Find the theme toggle button (has Sun, Moon, or Monitor icon)
    const themeButton = page.locator('button[title*="Theme:"]')

    // Get initial state
    const initialTitle = await themeButton.getAttribute('title')

    // Click to cycle
    await themeButton.click()

    // Should have changed
    const newTitle = await themeButton.getAttribute('title')
    expect(newTitle).not.toBe(initialTitle)
  })

  test('theme persists across navigation', async ({ page }) => {
    await page.goto('/settings')

    // Select dark mode
    await page.click('label:has-text("Dark")')

    // Navigate away
    await page.goto('/conversations')

    // Dark class should still be applied
    const htmlElement = page.locator('html')
    await expect(htmlElement).toHaveClass(/dark/)
  })

  test('respects system preference when system theme is selected', async ({ page }) => {
    // Set system preference to dark
    await page.emulateMedia({ colorScheme: 'dark' })

    await page.goto('/')

    // Should apply dark class because system prefers dark
    const htmlElement = page.locator('html')
    await expect(htmlElement).toHaveClass(/dark/)
  })

  test('respects light system preference', async ({ page }) => {
    // Set system preference to light
    await page.emulateMedia({ colorScheme: 'light' })

    await page.goto('/')

    // Should not have dark class
    const htmlElement = page.locator('html')
    await expect(htmlElement).not.toHaveClass(/dark/)
  })
})
