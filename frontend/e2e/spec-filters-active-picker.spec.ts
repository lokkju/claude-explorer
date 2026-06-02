// Spec-driven test: active-filter picker semantics.
//
// UX.md clauses verified (lines 615-738, "Composable filters"):
//   - "At most one filter is active at a time. The sidebar's active-filter
//     <Select> (between the title-search input and the source filter)
//     shows every enabled named filter; selecting one sets it as the
//     active filter. The sentinel option All conversations maps to no
//     active filter (nothing is filtered out)."
//   - "A disabled filter never appears in the active-filter <Select>."
//   - The picker offers a "Manage filters…" item that opens the modal
//     without changing the active filter (per the plan's design intent
//     for the v2 picker).
//
// NO APP CODE was read while writing this test.

import { test, expect, withNetRetry } from './fixtures'
import { makeSummary, withNetRetry } from './fixtures'

const conversations = [
  makeSummary({ uuid: 'c-foo', name: 'Foo morning' }),
  makeSummary({ uuid: 'c-bar', name: 'Bar afternoon' }),
]

async function pickerLocator(page: import('@playwright/test').Page) {
  // The migration banner exposes aria-label="Filter update", so a
  // /filter/i label fallback would conflict with the picker's testid in
  // strict-mode locators. The active-filter-select testid is the only
  // contract-implicit testid sanctioned by the spec (UX.md naming the
  // picker structurally). Use it directly.
  return page.getByTestId('active-filter-select')
}

test.describe('Active-filter picker', () => {
  test('"All conversations" sentinel persists activeId: null via PATCH', async ({ page, mockBackend }) => {
    let lastPatchBody: Record<string, unknown> | null = null

    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'a-1': {
              id: 'a-1',
              type: 'atom',
              name: 'Hide Foo',
              enabled: true,
              behavior: 'hide',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
          },
          activeId: 'a-1',
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })

    // Register the PATCH spy AFTER mockBackend so LIFO grants it
    // top priority. The handler delegates the actual response back to
    // mockBackend's stateful echo via route.fallback().
    await page.route('**/api/preferences', async (route, req) => {
      if (req.method() === 'PATCH' || req.method() === 'PUT') {
        try {
          const parsed = JSON.parse(req.postData() ?? '{}') as { data?: Record<string, unknown> }
          lastPatchBody = parsed.data ?? null
        } catch {
          lastPatchBody = null
        }
      }
      await route.fallback()
    })

    await withNetRetry(() => page.goto('/'))

    // Currently filtered (Foo hidden).
    await expect(page.getByText('Foo morning')).toHaveCount(0)

    const picker = await pickerLocator(page)
    await picker.click()
    const allOpt = page.getByRole('option', { name: /All conversations/i }).first()
    await expect(allOpt).toBeVisible()
    await allOpt.click()

    // Now unfiltered.
    await expect(page.getByText('Foo morning')).toBeVisible()
    await expect(page.getByText('Bar afternoon')).toBeVisible()

    // PATCH body persists activeId: null.
    await expect.poll(() => {
      const filters = lastPatchBody?.filters as { activeId?: unknown } | undefined
      return filters?.activeId
    }).toBeNull()
  })

  test('Picker lists only enabled filters', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'a-on': {
              id: 'a-on',
              type: 'atom',
              name: 'EnabledOne',
              enabled: true,
              behavior: 'hide',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
            'a-off': {
              id: 'a-off',
              type: 'atom',
              name: 'DisabledTwo',
              enabled: false,
              behavior: 'hide',
              patterns: ['*Bar*'],
              mode: 'glob',
              target: 'title',
            },
          },
          activeId: null,
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })

    await withNetRetry(() => page.goto('/'))
    const picker = await pickerLocator(page)
    await picker.click()

    await expect(page.getByRole('option', { name: /EnabledOne/i })).toBeVisible()
    await expect(page.getByRole('option', { name: /DisabledTwo/i })).toHaveCount(0)
  })

  test('Selection persists across reload (PATCH AND reload-displays-persisted)', async ({ page, mockBackend }) => {
    let lastPatchBody: Record<string, unknown> | null = null

    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'a-1': {
              id: 'a-1',
              type: 'atom',
              name: 'HideFoo',
              enabled: true,
              behavior: 'hide',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
          },
          activeId: null,
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })

    // PATCH spy AFTER mockBackend (LIFO).
    await page.route('**/api/preferences', async (route, req) => {
      if (req.method() === 'PATCH' || req.method() === 'PUT') {
        try {
          const parsed = JSON.parse(req.postData() ?? '{}') as { data?: Record<string, unknown> }
          lastPatchBody = parsed.data ?? null
        } catch {
          lastPatchBody = null
        }
      }
      await route.fallback()
    })

    await withNetRetry(() => page.goto('/'))

    // Pre-condition: no filter active. Foo visible.
    await expect(page.getByText('Foo morning')).toBeVisible()

    // Select HideFoo.
    let picker = await pickerLocator(page)
    await picker.click()
    const opt = page.getByRole('option', { name: /HideFoo/i }).first()
    await expect(opt).toBeVisible()
    await opt.click()

    // (1) Filter applied immediately.
    await expect(page.getByText('Foo morning')).toHaveCount(0)

    // (2) PATCH carried activeId.
    await expect.poll(() => {
      const filters = lastPatchBody?.filters as { activeId?: unknown } | undefined
      return filters?.activeId
    }).toBe('a-1')

    // (3) Reload: state persists; picker still reflects HideFoo and Foo
    // is still hidden.
    await withNetRetry(() => page.reload())
    await expect(page.getByText('Foo morning')).toHaveCount(0)
    picker = await pickerLocator(page)
    await expect(picker).toContainText(/HideFoo/i)
  })

  test('"Manage filters…" opens modal WITHOUT changing the active filter', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'a-1': {
              id: 'a-1',
              type: 'atom',
              name: 'HideFoo',
              enabled: true,
              behavior: 'hide',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
          },
          activeId: 'a-1',
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })

    await withNetRetry(() => page.goto('/'))
    const picker = await pickerLocator(page)
    // Wait for prefs hydration: the picker should reflect HideFoo BEFORE
    // we snapshot beforeText, otherwise it would still show the
    // placeholder "All conversations" and produce a misleading diff
    // after the modal closes.
    await expect(picker).toContainText(/HideFoo/i)
    const beforeText = await picker.innerText()

    await picker.click()
    const manageOpt = page.getByRole('option', { name: /manage filters/i }).or(
      page.getByRole('menuitem', { name: /manage filters/i }),
    ).first()
    await expect(manageOpt).toBeVisible()
    await manageOpt.click()

    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible()

    // Close the modal (Escape works for shadcn dialogs).
    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden()

    // Picker text unchanged.
    const afterText = await picker.innerText()
    expect(afterText.trim()).toBe(beforeText.trim())

    // Filter still active: Foo still hidden.
    await expect(page.getByText('Foo morning')).toHaveCount(0)
  })

  test('"Manage filters…" item is offered even when zero filters exist', async ({ page, mockBackend }) => {
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

    await withNetRetry(() => page.goto('/'))
    const picker = await pickerLocator(page)
    await picker.click()

    await expect(
      page.getByRole('option', { name: /manage filters/i }).or(
        page.getByRole('menuitem', { name: /manage filters/i }),
      ).first(),
    ).toBeVisible()
  })
})
