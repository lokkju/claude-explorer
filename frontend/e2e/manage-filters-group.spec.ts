/**
 * CF2 — Manage Filters modal: group editor.
 *
 * Builds two atoms (A: include glob `Foo*`; B: exclude glob `Bar*`), composes
 * them into a Group, sets the active filter to the group, and asserts the
 * sidebar list reflects AND vs OR composition.
 *
 * AND case (match: all of these):
 *   - "Foo Apple"  → matches A (include hits) AND passes B (no Bar)        → kept
 *   - "Foo Bar"    → matches A (Foo* hits) BUT fails B (Bar* hit, exclude) → hidden
 *   - "Baz"        → fails A (no Foo)                                       → hidden
 *
 * OR case (match: any of these):
 *   - "Foo Apple"  → A passes (Foo*), so OR passes                         → kept
 *   - "Foo Bar"    → A passes, OR passes                                   → kept
 *   - "Baz"        → A fails BUT B passes (no Bar*, exclude passes)        → kept
 */

import { test, expect } from './fixtures'
import { makeSummary } from './fixtures'

const conversations = [
  makeSummary({ uuid: 'c1', name: 'Foo Apple' }),
  makeSummary({ uuid: 'c2', name: 'Foo Bar' }),
  makeSummary({ uuid: 'c3', name: 'Baz' }),
]

test.describe('CF2 — manage filters group editor', () => {
  test('compose group, switch all-of vs any-of, sidebar updates', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {},
          activeId: null,
          _migratedV1: true,
        },
      },
    })

    await page.goto('/')

    // Open Manage filters.
    await page.getByRole('button', { name: /manage filters/i }).click()

    // Create atom A: include glob, pattern *Foo* (substring).
    await page.getByTestId('manage-filters-new').click()
    await page.getByTestId('filter-editor-name').fill('A include Foo')
    // type defaults to atom
    await page.getByTestId('filter-editor-polarity-include').click()
    await page.getByTestId('filter-editor-mode-glob').click()
    await page.getByTestId('filter-editor-patterns').fill('*Foo*')
    await page.getByTestId('filter-editor-save').click()

    // Create atom B: exclude glob, pattern *Bar* (substring).
    await page.getByTestId('manage-filters-new').click()
    await page.getByTestId('filter-editor-name').fill('B exclude Bar')
    await page.getByTestId('filter-editor-polarity-exclude').click()
    await page.getByTestId('filter-editor-mode-glob').click()
    await page.getByTestId('filter-editor-patterns').fill('*Bar*')
    await page.getByTestId('filter-editor-save').click()

    // Create a group containing both, match=all.
    await page.getByTestId('manage-filters-new').click()
    await page.getByTestId('filter-editor-type-group').click()
    await page.getByTestId('filter-editor-name').fill('AB-all')
    await page.getByTestId('filter-editor-match-all').click()
    // Add member A
    await page.getByTestId('filter-editor-add-member-trigger').click()
    await page.getByRole('option', { name: /A include Foo/i }).click()
    await page.getByTestId('filter-editor-add-member-button').click()
    // Verify A chip is now in the rail.
    await expect(page.getByTestId('filter-editor-members-list').locator('> span')).toHaveCount(1)
    // Add member B
    await page.getByTestId('filter-editor-add-member-trigger').click()
    await page.getByRole('option', { name: /B exclude Bar/i }).click()
    await page.getByTestId('filter-editor-add-member-button').click()
    // Both chips should be present.
    await expect(page.getByTestId('filter-editor-members-list').locator('> span')).toHaveCount(2)
    await page.getByTestId('filter-editor-save').click()

    // Close the modal.
    await page.keyboard.press('Escape')

    // Make AB-all the active filter via the sidebar picker.
    const picker = page.getByTestId('active-filter-select')
    await picker.click()
    await page.getByRole('option', { name: /^AB-all$/ }).click()

    // AND case — only Foo Apple visible.
    await expect(page.getByText('Foo Apple', { exact: true })).toBeVisible()
    await expect(page.getByText('Foo Bar', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Baz', { exact: true })).toHaveCount(0)

    // Switch group to match=any.
    await page.getByRole('button', { name: /manage filters/i }).click()
    // Click the group row to edit it.
    await page.getByTestId(/^filter-row-/).filter({ hasText: 'AB-all' }).click()
    await page.getByTestId('filter-editor-match-any').click()
    await page.getByTestId('filter-editor-save').click()
    await page.keyboard.press('Escape')

    // OR case — all three visible (Baz passes B's exclude since no Bar*).
    await expect(page.getByText('Foo Apple', { exact: true })).toBeVisible()
    await expect(page.getByText('Foo Bar', { exact: true })).toBeVisible()
    await expect(page.getByText('Baz', { exact: true })).toBeVisible()
  })
})
