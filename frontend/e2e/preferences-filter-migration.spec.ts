/**
 * P3f — FilterContext dual-read/dual-write migration via usePreferences.
 *
 * After this commit, the two persistent FilterContext keys must:
 *
 *   - savedFilters    (Filter[]   — full set of saved filter definitions)
 *   - activeFilterIds (string[]   — pinned-active subset)
 *
 * 1. PATCH `/api/preferences` when the user changes them (the body
 *    contains the changed key under `data`).
 * 2. Mirror the new value into `localStorage` under the EXACT same key
 *    the legacy code used (so existing browser sessions keep working).
 * 3. Read from the server envelope on first mount when the server has
 *    a value for that key (server beats local; local beats fallback).
 *
 * As with P3c, the local mirror is NOT removed in this commit — that
 * comes after the soak window.
 */

import { test, expect } from './fixtures'
import type { Route } from '@playwright/test'

interface PrefsState {
  data: Record<string, unknown>
}

interface PatchLog {
  bodies: Array<Record<string, unknown>>
}

async function installPrefsRoute(
  page: import('@playwright/test').Page,
  initial: Record<string, unknown> = {},
): Promise<{ state: PrefsState; patches: PatchLog }> {
  const state: PrefsState = { data: { ...initial } }
  const patches: PatchLog = { bodies: [] }

  await page.route('**/api/preferences', (route: Route) => {
    const req = route.request()
    if (req.method() === 'PATCH') {
      let body: { data?: Record<string, unknown> } = {}
      try {
        body = JSON.parse(req.postData() ?? '{}')
      } catch {
        body = {}
      }
      const patchData = body.data ?? {}
      patches.bodies.push(patchData)
      Object.assign(state.data, patchData)
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ version: 1, data: state.data }),
      })
      return
    }
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version: 1, data: state.data }),
    })
  })

  return { state, patches }
}

test.describe('FilterContext preferences migration (P3f)', () => {
  test('Adding a saved filter PATCHes server preferences', async ({ page, mockBackend }) => {
    await mockBackend({})
    const { patches } = await installPrefsRoute(page, {})

    await page.goto('/')
    await page.evaluate(() => {
      localStorage.removeItem('savedFilters')
      localStorage.removeItem('activeFilterIds')
    })
    await page.reload()

    // Open the manage filters dialog and create a new filter.
    await page.getByRole('button', { name: /manage filters/i }).click()
    await expect(page.getByRole('dialog', { name: /manage filters/i })).toBeVisible()
    await page.getByRole('button', { name: /add filter/i }).click()

    await page.getByLabel(/filter name/i).fill('TestFilter')
    await page.getByLabel(/patterns/i).fill('*foo*')
    await page.getByRole('button', { name: /save/i }).click()

    // Assert at least one PATCH body has key `savedFilters` with array
    // containing our new filter.
    await expect.poll(() => patches.bodies.length, { timeout: 5_000 }).toBeGreaterThan(0)
    const sawFilterPatch = patches.bodies.some((b) => {
      const sf = (b as Record<string, unknown>).savedFilters
      return Array.isArray(sf) && sf.some(
        (f) => typeof f === 'object' && f !== null && (f as { name?: string }).name === 'TestFilter',
      )
    })
    expect(sawFilterPatch).toBe(true)

    // localStorage mirror must also contain the new filter.
    const mirror = await page.evaluate(() => localStorage.getItem('savedFilters'))
    expect(mirror).not.toBeNull()
    const parsed = JSON.parse(mirror as string) as Array<{ name: string }>
    expect(parsed.some((f) => f.name === 'TestFilter')).toBe(true)

    // The migration marker is set.
    const marker = await page.evaluate(() => localStorage.getItem('prefs_migrated_v1'))
    expect(marker).toBe('true')
  })

  test('savedFilters restored from server on first mount', async ({ page, mockBackend }) => {
    await mockBackend({})
    await installPrefsRoute(page, {
      savedFilters: [
        {
          id: 'srv-a',
          name: 'TestFilter',
          patterns: ['*srv*'],
          polarity: 'include',
          mode: 'glob',
          target: 'title',
          pinned: false,
        },
      ],
    })

    await page.goto('/')
    await page.evaluate(() => {
      localStorage.removeItem('savedFilters')
      localStorage.removeItem('activeFilterIds')
    })
    await page.reload()

    // Open the manage filters dialog; the server-supplied filter must appear.
    await page.getByRole('button', { name: /manage filters/i }).click()
    const dialog = page.getByRole('dialog', { name: /manage filters/i })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('TestFilter')).toBeVisible()
  })
})
