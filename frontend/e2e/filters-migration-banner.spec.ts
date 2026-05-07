/**
 * CF3 — One-time migration banner.
 *
 * Conditions for rendering: `filters._migratedV1 === true` AND
 * `filters.migrationBannerDismissed !== true`.
 *
 * Placement: directly above the conversation list in the sidebar (the
 * conversation list lives in the sidebar in this app — that's where the
 * filter selection takes effect).
 *
 * Cases under test:
 *   1. Migrated user, not yet dismissed -> banner visible.
 *   2. Click Dismiss -> PATCH to /api/preferences with
 *      `migrationBannerDismissed: true`; banner disappears.
 *   3. Reload (mock keeps the dismissed flag in prefs) -> banner stays gone.
 *   4. Fresh install (`_migratedV1: false`) -> banner never visible.
 */

import { test, expect } from './fixtures'
import { makeSummary } from './fixtures'
import type { FiltersState } from '../src/lib/filterEngine'

const conversations = [
  makeSummary({
    uuid: 'conv-1',
    name: 'Some conversation',
    source: 'CLAUDE_CODE',
    project_path: '/p/explorer',
    project_name: 'explorer',
  }),
]

// Pre-migrated filters blob: `_migratedV1: true`, banner not yet dismissed.
const migratedNotDismissed: FiltersState = {
  nodes: {
    'scan-gmail': {
      type: 'atom',
      id: 'scan-gmail',
      name: 'Scan Gmail',
      enabled: true,
      patterns: ['Scan Gmail*'],
      polarity: 'exclude',
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
  migrationBannerDismissed: false,
}

const migratedDismissed: FiltersState = {
  ...migratedNotDismissed,
  migrationBannerDismissed: true,
}

const freshInstall: FiltersState = {
  nodes: {},
  activeId: null,
  _migratedV1: false,
}

test.describe('CF3 — migration banner', () => {
  test('visible after migration; dismiss persists; reload keeps it dismissed', async ({
    page,
    mockBackend,
  }) => {
    await mockBackend({
      conversations,
      preferences: { filters: migratedNotDismissed },
    })

    // Capture every preferences PATCH so we can assert the dismiss payload.
    const patchPayloads: Array<Record<string, unknown>> = []
    page.on('request', (req) => {
      if (
        req.method() === 'PATCH' &&
        req.url().includes('/api/preferences')
      ) {
        try {
          const body = JSON.parse(req.postData() ?? '{}') as {
            data?: Record<string, unknown>
          }
          if (body.data) patchPayloads.push(body.data)
        } catch {
          /* ignore */
        }
      }
    })

    await page.goto('/')

    const banner = page.getByTestId('filters-migration-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText(/Filters are now composable/i)
    await expect(banner).toContainText(/Default \(migrated\)/i)
    await expect(banner).toContainText(/Manage filters/i)

    // Click Dismiss -> banner disappears, PATCH fires.
    await page.getByTestId('filters-migration-banner-dismiss').click()
    await expect(banner).toHaveCount(0)

    // The PATCH should include filters.migrationBannerDismissed=true.
    await expect.poll(() => {
      return patchPayloads.some((p) => {
        const f = p.filters as { migrationBannerDismissed?: boolean } | undefined
        return f?.migrationBannerDismissed === true
      })
    }).toBeTruthy()

    // Reload. The mockBackend prefs store was mutated by the PATCH, so a
    // subsequent GET reflects `migrationBannerDismissed: true` and the
    // banner does NOT reappear.
    await page.reload()
    await expect(page.getByTestId('filters-migration-banner')).toHaveCount(0)
  })

  test('explicit dismissed flag hides the banner from initial load', async ({
    page,
    mockBackend,
  }) => {
    await mockBackend({
      conversations,
      preferences: { filters: migratedDismissed },
    })

    await page.goto('/')
    await expect(page.getByTestId('filters-migration-banner')).toHaveCount(0)
  })

  test('fresh install (no migration) never shows the banner', async ({
    page,
    mockBackend,
  }) => {
    await mockBackend({
      conversations,
      preferences: { filters: freshInstall },
    })

    await page.goto('/')

    // Wait for the sidebar to render so we know the app has settled.
    await expect(page.getByTestId('active-filter-select')).toBeVisible()

    // No banner.
    await expect(page.getByTestId('filters-migration-banner')).toHaveCount(0)
  })
})
