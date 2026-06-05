/**
 * CF1 — sidebar active-filter picker (composable filters).
 *
 * After Phase 1 the sidebar shows a single <Select> picker between the
 * title-search input and the source-filter row. Options are:
 *   - "All conversations"  (sentinel; sets activeId=null)
 *   - every enabled filter (atom or group) by name
 *
 * Selection persists via /api/preferences PATCH; reload reflects it.
 */

import { test, expect, withNetRetry } from './fixtures'
import { makeSummary } from './fixtures'
import type { FiltersState } from '../src/lib/filterEngine'

const matchingConv = makeSummary({
  uuid: 'gmail-1',
  name: 'Scan Gmail for meeting invites and calendar invites',
  source: 'CLAUDE_CODE',
  project_path: '/p/explorer',
  project_name: 'explorer',
})

const otherConv = makeSummary({
  uuid: 'react-1',
  name: 'React refactor',
  source: 'CLAUDE_CODE',
  project_path: '/p/explorer',
  project_name: 'explorer',
})

const conversations = [matchingConv, otherConv]

// A pre-migrated v2 FiltersState with one hide atom referenced by a
// group (groups have no behavior in v2 — pure boolean combinator over
// children's keep/drop), activeId pointing at the group. Matches the
// user's actual prefs shape after the v1→v2 migration.
const filtersBlob: FiltersState = {
  nodes: {
    'scan-gmail': {
      type: 'atom',
      id: 'scan-gmail',
      name: 'Scan Gmail',
      enabled: true,
      patterns: ['Scan Gmail*'],
      behavior: 'hide',
      mode: 'glob',
      target: 'title',
    },
    'default-migrated': {
      type: 'group',
      id: 'default-migrated',
      name: 'Default (migrated)',
      enabled: true,
      match: 'all',
      childIds: ['scan-gmail'],
    },
  },
  activeId: 'default-migrated',
  _migratedV1: true,
  _migratedV2: true,
}

test.describe('CF1 — active-filter picker', () => {
  test('exclude filter hides matching rows; "All conversations" reveals; reload persists selection', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: { filters: filtersBlob },
    })

    await withNetRetry(page, () => page.goto('/'))

    // The exclude atom is active via its parent group -> matching row hidden.
    await expect(page.getByText('React refactor')).toBeVisible()
    await expect(
      page.getByText('Scan Gmail for meeting invites and calendar invites')
    ).toHaveCount(0)

    // Pick "All conversations" -> matching row reappears.
    const picker = page.getByTestId('active-filter-select')
    await expect(picker).toBeVisible()
    await picker.click()
    await page.getByRole('option', { name: /^All conversations$/i }).click()

    await expect(
      page.getByText('Scan Gmail for meeting invites and calendar invites')
    ).toBeVisible()

    // Pick the migrated group again -> matching row hidden again.
    await picker.click()
    await page.getByRole('option', { name: /Default \(migrated\)/i }).click()
    await expect(
      page.getByText('Scan Gmail for meeting invites and calendar invites')
    ).toHaveCount(0)

    // Reload -> selection persists (mockBackend's prefs store survives the
    // navigation because page.route handlers stay registered for the page).
    await withNetRetry(page, () => page.reload())
    await expect(
      page.getByText('Scan Gmail for meeting invites and calendar invites')
    ).toHaveCount(0)
    // Picker still shows the group as the active selection.
    await expect(picker).toContainText(/Default \(migrated\)/i)
  })
})
