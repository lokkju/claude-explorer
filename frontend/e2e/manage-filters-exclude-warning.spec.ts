/**
 * CF2 — Group editor "exclude + any" warning.
 *
 * A `match: 'any'` group whose chip-members are ALL `polarity: 'exclude'`
 * atoms passes for almost every conversation (any one not-matching means
 * the whole OR passes). The editor surfaces a warning in this state.
 *
 * Hidden when:
 *   - match switches to 'all'
 *   - any member's polarity becomes 'include'
 *   - the group becomes empty (not all-exclude → no warning)
 */

import { test, expect } from './fixtures'
import type { FiltersState } from '../src/lib/filterEngine'

const seedState: FiltersState = {
  nodes: {
    'ex-a': {
      type: 'atom',
      id: 'ex-a',
      name: 'Exclude A',
      enabled: true,
      patterns: ['*invoice*'],
      polarity: 'exclude',
      mode: 'glob',
      target: 'title',
    },
    'ex-b': {
      type: 'atom',
      id: 'ex-b',
      name: 'Exclude B',
      enabled: true,
      patterns: ['*standup*'],
      polarity: 'exclude',
      mode: 'glob',
      target: 'title',
    },
  },
  activeId: null,
  _migratedV1: true,
}

test.describe('CF2 — exclude+any warning', () => {
  test('warning shows for all-exclude any-of group; hides under safer combinations', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations: [],
      preferences: { filters: seedState },
    })

    await page.goto('/')
    await page.getByRole('button', { name: /manage filters/i }).click()

    // Build a new group with both exclude atoms, match=any.
    await page.getByTestId('manage-filters-new').click()
    await page.getByTestId('filter-editor-type-group').click()
    await page.getByTestId('filter-editor-name').fill('Exclude OR group')
    await page.getByTestId('filter-editor-match-any').click()

    // Add Exclude A
    await page.getByTestId('filter-editor-add-member-trigger').click()
    await page.getByRole('option', { name: /^Exclude A/ }).click()
    await page.getByTestId('filter-editor-add-member-button').click()
    // Add Exclude B
    await page.getByTestId('filter-editor-add-member-trigger').click()
    await page.getByRole('option', { name: /^Exclude B/ }).click()
    await page.getByTestId('filter-editor-add-member-button').click()

    // Warning should be visible.
    await expect(page.getByTestId('filter-editor-exclude-any-warning')).toBeVisible()

    // Switch to match=all → warning hides.
    await page.getByTestId('filter-editor-match-all').click()
    await expect(page.getByTestId('filter-editor-exclude-any-warning')).toHaveCount(0)

    // Switch back to any; warning returns.
    await page.getByTestId('filter-editor-match-any').click()
    await expect(page.getByTestId('filter-editor-exclude-any-warning')).toBeVisible()

    // Remove one member; only one exclude remains — still all-exclude → warning still visible.
    await page.getByTestId('filter-editor-member-remove-ex-b').click()
    await expect(page.getByTestId('filter-editor-exclude-any-warning')).toBeVisible()

    // Remove the last one → empty group → warning hides (vacuous truth guard).
    await page.getByTestId('filter-editor-member-remove-ex-a').click()
    await expect(page.getByTestId('filter-editor-exclude-any-warning')).toHaveCount(0)
  })
})
