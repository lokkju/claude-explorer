import { test, expect, makeSummary, withNetRetry } from './fixtures'

/**
 * D8 — "Show archived" sidebar toggle.
 *
 * Pins:
 *  - Toggle is visible under the Cowork source filter (and 'all').
 *  - Hidden under CLAUDE_AI / CLAUDE_CODE (no archived flag on those).
 *  - Default-off: an archived session NOT present in the list.
 *  - Toggle-on: backend receives ?show_archived=true; archived session
 *    becomes visible.
 */

const ARCHIVED_UUID = 'aaaa9999-0000-0000-0000-000000000001'
const ACTIVE_UUID = 'aaaa9999-0000-0000-0000-000000000002'

const archived = makeSummary({
  uuid: ARCHIVED_UUID,
  name: 'Archived Cowork',
  source: 'CLAUDE_COWORK',
  is_archived: true,
})

const active = makeSummary({
  uuid: ACTIVE_UUID,
  name: 'Active Cowork',
  source: 'CLAUDE_COWORK',
  is_archived: false,
})

test.describe('Cowork D8 — Show archived toggle', () => {
  test('toggle filters archived sessions in and out', async ({
    page,
    mockBackend,
  }) => {
    await mockBackend({ conversations: [active] })

    // Local route mock: when ?show_archived=true, return both; else
    // return only the active one. Mirrors the backend server-side
    // filter contract.
    await page.route('**/api/conversations**', (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.match(/\/api\/conversations\/[^/]+(\/|$)/)) {
        return route.fallback()
      }
      const showArchived = url.searchParams.get('show_archived') === 'true'
      const body = showArchived ? [active, archived] : [active]
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
    })

    await withNetRetry(() => page.goto('/'))

    // Switch to Cowork filter so the toggle is visible.
    await page.getByTestId('source-filter-select').click()
    await page.getByRole('option', { name: /Claude Cowork/i }).click()

    // Settle: active session visible; archived NOT.
    await expect(page.getByText('Active Cowork')).toBeVisible()
    await expect(page.getByText('Archived Cowork')).toBeHidden()

    // Toggle on. Use .click() rather than .check()/.uncheck() because
    // the controlled checkbox's onChange path goes through usePreferences
    // (server PATCH + localStorage), and Playwright's .check() asserts
    // post-click state synchronously — too tight a window for the
    // React commit. .click() is permissive about the state-change
    // round-trip.
    const toggle = page.getByTestId('show-archived-sessions-toggle')
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(toggle).toBeChecked()

    // Archived session now appears.
    await expect(page.getByText('Archived Cowork')).toBeVisible()
    await expect(page.getByText('Active Cowork')).toBeVisible()

    // Toggle off — archived hides again.
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await expect(page.getByText('Archived Cowork')).toBeHidden()
  })

  test('toggle is HIDDEN under Claude Code source filter', async ({
    page,
    mockBackend,
  }) => {
    await mockBackend({ conversations: [active] })

    // Switch to Claude Code; toggle should disappear.
    await withNetRetry(() => page.goto('/'))
    await page.getByTestId('source-filter-select').click()
    await page.getByRole('option', { name: /^Claude Code$/i }).click()

    await expect(page.getByTestId('show-archived-sessions-toggle')).toBeHidden()
  })
})
