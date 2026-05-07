/**
 * CF2 — "Used by" line + delete-blocking when referenced.
 *
 *   1. Atom A is a member of group G.
 *   2. Open A: "Used by: G" line is visible directly under the name input.
 *   3. Click A's delete; assert the delete is blocked with a message naming G.
 *   4. Remove A from G; reopen A; delete now succeeds (row disappears).
 */

import { test, expect } from './fixtures'
import type { FiltersState } from '../src/lib/filterEngine'

const seedState: FiltersState = {
  nodes: {
    'atom-a': {
      type: 'atom',
      id: 'atom-a',
      name: 'Atom A',
      enabled: true,
      patterns: ['Foo*'],
      polarity: 'include',
      mode: 'glob',
      target: 'title',
    },
    'group-g': {
      type: 'group',
      id: 'group-g',
      name: 'Group G',
      enabled: true,
      match: 'all',
      childIds: ['atom-a'],
    },
  },
  activeId: null,
  _migratedV1: true,
}

test.describe('CF2 — used-by + delete blocking', () => {
  test('used-by line, blocked delete, then unblocked after removal', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations: [],
      preferences: { filters: seedState },
    })

    await page.goto('/')
    await page.getByRole('button', { name: /manage filters/i }).click()

    // 1+2. Open Atom A in the editor; the Used-by line shows "Group G".
    await page.getByTestId('filter-row-atom-a').click()
    const usedBy = page.getByTestId('filter-editor-used-by')
    await expect(usedBy).toBeVisible()
    await expect(usedBy).toContainText(/Group G/)

    // 3. Try to delete Atom A; expect blocked message naming G.
    await page.getByTestId('filter-row-delete-atom-a').click()
    const blocked = page.getByTestId('filter-delete-blocked-atom-a')
    await expect(blocked).toBeVisible()
    await expect(blocked).toContainText(/Group G/)

    // Verify it really wasn't deleted.
    await expect(page.getByTestId('filter-row-atom-a')).toBeVisible()

    // 4. Remove A from G via the group editor.
    await page.getByTestId('filter-row-group-g').click()
    await page.getByTestId('filter-editor-member-remove-atom-a').click()
    await page.getByTestId('filter-editor-save').click()

    // Now delete A: confirm flow → succeeds.
    await page.getByTestId('filter-row-delete-atom-a').click()
    // After unblocking, a confirmation [Cancel][Confirm] appears.
    await page.getByTestId('filter-row-delete-confirm-atom-a').click()
    await expect(page.getByTestId('filter-row-atom-a')).toHaveCount(0)
  })
})
