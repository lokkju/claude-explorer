/**
 * CFR1 — Manage Filters modal: group editor (v2 of CF2).
 *
 * Builds two atoms (A: show-only glob `Foo*`; B: hide glob `Bar*`), composes
 * them into a Group, sets the active filter to the group, and asserts the
 * sidebar list reflects AND vs OR composition. Same compose-passes
 * semantics as CF2 — the only change here is the UI labels (Behavior
 * radio replaces the v1 polarity radio).
 *
 * AND case (match: all of these):
 *   - "Foo Apple"  → A keeps (Foo* hits, show-only) AND B keeps (no Bar)   → kept
 *   - "Foo Bar"    → A keeps BUT B drops (Bar* hits, hide)                  → hidden
 *   - "Baz"        → A drops (no Foo)                                        → hidden
 *
 * OR case (match: any of these):
 *   - "Foo Apple"  → A keeps, OR keeps                                       → kept
 *   - "Foo Bar"    → A keeps, OR keeps                                       → kept
 *   - "Baz"        → A drops BUT B keeps (no Bar match, hide passes)        → kept
 */

import { test, expect, withNetRetry } from './fixtures'
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
          _migratedV2: true,
        },
      },
    })

    await withNetRetry(page, () => page.goto('/'))

    // Open Manage filters.
    // CFR1: "Manage filters…" lives inside the active-filter picker
    // dropdown (commit 976a5f1 moved it there).
    await page.getByTestId('active-filter-select').click()
    await page.getByTestId('active-filter-manage').click()

    // Create atom A: show-only glob, pattern *Foo* (substring).
    await page.getByTestId('manage-filters-new').click()
    await page.getByTestId('filter-editor-name').fill('A show-only Foo')
    // type defaults to atom
    await page.getByTestId('filter-editor-behavior-show-only').click()
    await page.getByTestId('filter-editor-mode-glob').click()
    await page.getByTestId('filter-editor-patterns').fill('*Foo*')
    await page.getByTestId('filter-editor-save').click()

    // Create atom B: hide glob, pattern *Bar* (substring).
    await page.getByTestId('manage-filters-new').click()
    await page.getByTestId('filter-editor-name').fill('B hide Bar')
    await page.getByTestId('filter-editor-behavior-hide').click()
    await page.getByTestId('filter-editor-mode-glob').click()
    await page.getByTestId('filter-editor-patterns').fill('*Bar*')
    await page.getByTestId('filter-editor-save').click()

    // Create a group containing both, match=all. Groups have no
    // behavior in CFR1 — they are pure boolean combinators over the
    // children's keep/drop decisions.
    await page.getByTestId('manage-filters-new').click()
    await page.getByTestId('filter-editor-type-group').click()
    await page.getByTestId('filter-editor-name').fill('AB-all')
    await page.getByTestId('filter-editor-match-all').click()
    // Add member A
    await page.getByTestId('filter-editor-add-member-trigger').click()
    await page.getByRole('option', { name: /A show-only Foo/i }).click()
    await page.getByTestId('filter-editor-add-member-button').click()
    // Verify A chip is now in the rail.
    await expect(page.getByTestId('filter-editor-members-list').locator('> span')).toHaveCount(1)
    // Add member B
    await page.getByTestId('filter-editor-add-member-trigger').click()
    await page.getByRole('option', { name: /B hide Bar/i }).click()
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
    // CFR1: "Manage filters…" lives inside the active-filter picker
    // dropdown (commit 976a5f1 moved it there).
    await page.getByTestId('active-filter-select').click()
    await page.getByTestId('active-filter-manage').click()
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
