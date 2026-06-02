/**
 * CFR1 — the user's exact "hide cron1 OR cron2" case.
 *
 * In v1 this required: atom A (exclude cron1), atom B (exclude cron2),
 * group "all of these" with [A, B], activate the group. 5 clicks across
 * 2 screens, with the user reasoning about double-negation
 * ("each atom EXCLUDES, group ALL means both must pass which means
 * neither matches"). The "exclude + any" warning the editor surfaced
 * caught the wrong combination and pointed at the wrong path.
 *
 * In v2: ONE atom, Behavior=Hide, patterns=cron1+cron2 (one per line,
 * OR'd at evaluation). The user picks the atom from the active-filter
 * picker; matching rows disappear, others stay. That's the redesign's
 * load-bearing UX claim.
 */

import { test, expect, withNetRetry } from './fixtures'
import { makeSummary } from './fixtures'

const conversations = [
  makeSummary({ uuid: 'c1', name: 'cron1 daily backup' }),
  makeSummary({ uuid: 'c2', name: 'cron2 weekly cleanup' }),
  makeSummary({ uuid: 'c3', name: 'morning standup notes' }),
  makeSummary({ uuid: 'c4', name: 'React refactor plan' }),
]

test.describe('CFR1 — cron case (one atom, hide, OR\'d patterns)', () => {
  test('one atom with Behavior=Hide and two patterns hides both cron rows; others stay', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: { nodes: {}, activeId: null, _migratedV1: true, _migratedV2: true },
      },
    })

    await withNetRetry(() => page.goto('/'))

    // Sanity: all 4 rows visible before any filter is active.
    for (const c of conversations) {
      await expect(page.getByText(c.name, { exact: true })).toBeVisible()
    }

    // Build a single hide atom with the two cron patterns.
    // CFR1: "Manage filters…" is an item inside the active-filter picker.
    await page.getByTestId('active-filter-select').click()
    await page.getByTestId('active-filter-manage').click()
    await page.getByTestId('manage-filters-new').click()
    await page.getByTestId('filter-editor-name').fill('Cron noise')
    // Behavior at the top — "Hide matches".
    await page.getByTestId('filter-editor-behavior-hide').click()
    await page.getByTestId('filter-editor-mode-glob').click()
    // OR'd patterns, one per line.
    await page.getByTestId('filter-editor-patterns').fill('*cron1*\n*cron2*')

    // Plain-English summary should reflect the configuration.
    await expect(page.getByTestId('filter-editor-summary')).toContainText(
      /Hides conversations whose titles match any of:.*cron1.*cron2/i,
    )

    await page.getByTestId('filter-editor-save').click()
    await page.keyboard.press('Escape')

    // Activate via the picker.
    const picker = page.getByTestId('active-filter-select')
    await picker.click()
    await page.getByRole('option', { name: /^Cron noise$/ }).click()

    // Both cron rows hidden; others kept.
    await expect(page.getByText('cron1 daily backup', { exact: true })).toHaveCount(0)
    await expect(page.getByText('cron2 weekly cleanup', { exact: true })).toHaveCount(0)
    await expect(page.getByText('morning standup notes', { exact: true })).toBeVisible()
    await expect(page.getByText('React refactor plan', { exact: true })).toBeVisible()

    // Switch back to "All conversations" — both cron rows return.
    await picker.click()
    await page.getByRole('option', { name: /^All conversations$/i }).click()
    await expect(page.getByText('cron1 daily backup', { exact: true })).toBeVisible()
    await expect(page.getByText('cron2 weekly cleanup', { exact: true })).toBeVisible()
  })
})
