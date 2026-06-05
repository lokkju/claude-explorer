/**
 * CF2 — Atom name prefill from first pattern.
 *
 * Behavior under test:
 *   1. Open "+ New filter"; type "Foo Bar*" into Patterns. After 300ms the
 *      Name input shows "Foo Bar".
 *   2. Manually type into Name; subsequent pattern edits don't override.
 *   3. Clear Name; pattern prefill resumes.
 *   4. Save; reopen the filter; Name persists as last value the user typed.
 */

import { test, expect, withNetRetry } from './fixtures'

test.describe('CF2 — atom name prefill', () => {
  test('prefill, manual override, resume on clear, persistence', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations: [],
      preferences: {
        filters: { nodes: {}, activeId: null, _migratedV1: true, _migratedV2: true },
      },
    })

    await withNetRetry(page, () => page.goto('/'))
    await page.getByTestId('active-filter-select').click()
    await page.getByTestId('active-filter-manage').click()
    await page.getByTestId('manage-filters-new').click()

    const nameInput = page.getByTestId('filter-editor-name')
    const patternsTa = page.getByTestId('filter-editor-patterns')

    await expect(nameInput).toHaveAttribute('placeholder', /auto-fill|auto-filled|auto fill/i)

    // 1. Type into patterns, expect prefill after debounce.
    // Use Tab to blur the textarea (don't click body / overlay — both
    // close the Dialog). The prefill effect runs after 300ms of no
    // pattern changes, regardless of where focus moves, as long as it's
    // off the Name input.
    await patternsTa.click()
    await patternsTa.fill('Foo Bar*')
    await page.keyboard.press('Tab')
    await expect(nameInput).toHaveValue('Foo Bar', { timeout: 2000 })

    // 2. Manually type; prefill stops.
    await nameInput.click()
    await nameInput.fill('My custom name')
    await page.keyboard.press('Tab')
    await patternsTa.click()
    await patternsTa.fill('Different*Pattern')
    await page.keyboard.press('Tab')
    // Wait past debounce window, ensure name didn't shift.
    await page.waitForTimeout(500)
    await expect(nameInput).toHaveValue('My custom name')

    // 3. Clear Name; prefill resumes from current pattern.
    await nameInput.click()
    await nameInput.fill('')
    await page.keyboard.press('Tab')
    // Re-trigger pattern change to wake the effect.
    await patternsTa.click()
    await patternsTa.fill('Other*Words')
    await page.keyboard.press('Tab')
    await expect(nameInput).toHaveValue('OtherWords', { timeout: 2000 })

    // 4. Type final name and save.
    await nameInput.click()
    await nameInput.fill('Final name')
    await page.keyboard.press('Tab')
    await page.getByTestId('filter-editor-save').click()

    // Reopen the saved filter from the list. The row shows the saved name.
    await page.getByTestId(/^filter-row-/).filter({ hasText: 'Final name' }).click()
    await expect(nameInput).toHaveValue('Final name')
  })
})
