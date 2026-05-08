// Spec-driven test: atom-level Behavior semantics.
//
// UX.md clauses verified (lines 615-738, "Composable filters"):
//   - "Atoms carry one set of patterns plus a Behavior (hide / show-only)
//     and a mode (glob / regex). The Behavior controls what happens to a
//     conversation that matches at least one of the atom's patterns:
//     Hide matches drops it; Show only matches keeps it (and drops
//     everything else)."
//   - "An atom with zero patterns passes for every conversation." (least
//     surprise)
//   - "A disabled filter never appears in the active-filter <Select> and
//     cannot be selected as active."
//   - "If the active filter itself is disabled it becomes a no-op (treated
//     as 'no filter active') instead of throwing."
//
// NO APP CODE was read while writing this test.

import { test, expect } from './fixtures'
import { makeSummary } from './fixtures'

const conversations = [
  makeSummary({ uuid: 'c-foo', name: 'Foo morning' }),
  makeSummary({ uuid: 'c-bar', name: 'Bar afternoon' }),
  makeSummary({ uuid: 'c-baz', name: 'Baz evening' }),
]

async function pickFilter(page: import('@playwright/test').Page, name: string | RegExp) {
  // Pin to the contract-implicit testid; the migration banner exposes
  // aria-label="Filter update" which would conflict with a /filter/i
  // label fallback in strict-mode locators.
  const picker = page.getByTestId('active-filter-select')
  await picker.click()
  const opt = page.getByRole('option', { name }).first()
  await expect(opt).toBeVisible()
  await opt.click()
}

test.describe('Atom semantics — Behavior, mode, empty, disabled', () => {
  test('Behavior=hide + glob: matching titles disappear from sidebar', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'atom-1': {
              id: 'atom-1',
              type: 'atom',
              name: 'Hide Foo',
              enabled: true,
              behavior: 'hide',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
          },
          activeId: 'atom-1',
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })
    await page.goto('/')

    await expect(page.getByText('Bar afternoon')).toBeVisible()
    await expect(page.getByText('Baz evening')).toBeVisible()
    await expect(page.getByText('Foo morning')).toHaveCount(0)
  })

  test('Behavior=show-only + glob: only matching titles remain', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'atom-1': {
              id: 'atom-1',
              type: 'atom',
              name: 'Show only Bar',
              enabled: true,
              behavior: 'show-only',
              patterns: ['*Bar*'],
              mode: 'glob',
              target: 'title',
            },
          },
          activeId: 'atom-1',
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })
    await page.goto('/')

    await expect(page.getByText('Bar afternoon')).toBeVisible()
    await expect(page.getByText('Foo morning')).toHaveCount(0)
    await expect(page.getByText('Baz evening')).toHaveCount(0)
  })

  test('Behavior=hide + regex mode: regex pattern hides matches', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'atom-1': {
              id: 'atom-1',
              type: 'atom',
              name: 'Hide regex',
              enabled: true,
              behavior: 'hide',
              patterns: ['^Ba'],
              mode: 'regex',
              target: 'title',
            },
          },
          activeId: 'atom-1',
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })
    await page.goto('/')

    await expect(page.getByText('Foo morning')).toBeVisible()
    await expect(page.getByText('Bar afternoon')).toHaveCount(0)
    await expect(page.getByText('Baz evening')).toHaveCount(0)
  })

  test('Behavior=show-only + regex mode: regex pattern keeps only matches', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'atom-1': {
              id: 'atom-1',
              type: 'atom',
              name: 'Show only regex',
              enabled: true,
              behavior: 'show-only',
              patterns: ['^Foo'],
              mode: 'regex',
              target: 'title',
            },
          },
          activeId: 'atom-1',
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })
    await page.goto('/')

    await expect(page.getByText('Foo morning')).toBeVisible()
    await expect(page.getByText('Bar afternoon')).toHaveCount(0)
    await expect(page.getByText('Baz evening')).toHaveCount(0)
  })

  test('Empty-patterns atom passes every conversation (least surprise)', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'atom-empty': {
              id: 'atom-empty',
              type: 'atom',
              name: 'Empty atom',
              enabled: true,
              behavior: 'hide',
              patterns: [],
              mode: 'glob',
              target: 'title',
            },
          },
          activeId: 'atom-empty',
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })
    await page.goto('/')

    await expect(page.getByText('Foo morning')).toBeVisible()
    await expect(page.getByText('Bar afternoon')).toBeVisible()
    await expect(page.getByText('Baz evening')).toBeVisible()
  })

  test('Disabled atom set as active is a no-op: every conversation visible', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'atom-1': {
              id: 'atom-1',
              type: 'atom',
              name: 'Hide Foo (disabled)',
              enabled: false,
              behavior: 'hide',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
          },
          activeId: 'atom-1',
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })
    await page.goto('/')

    // Disabled active = no-op. All three rows still visible.
    await expect(page.getByText('Foo morning')).toBeVisible()
    await expect(page.getByText('Bar afternoon')).toBeVisible()
    await expect(page.getByText('Baz evening')).toBeVisible()
  })

  test('Disabled atom is hidden from the active-filter picker', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'atom-enabled': {
              id: 'atom-enabled',
              type: 'atom',
              name: 'Enabled Foo',
              enabled: true,
              behavior: 'hide',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
            'atom-disabled': {
              id: 'atom-disabled',
              type: 'atom',
              name: 'Disabled Bar',
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
    await page.goto('/')

    // Pin to the contract-implicit testid; the migration banner exposes
    // aria-label="Filter update" which would conflict with a /filter/i
    // label fallback in strict-mode locators.
    const picker = page.getByTestId('active-filter-select')
    await picker.click()

    // Enabled filter appears
    await expect(page.getByRole('option', { name: /Enabled Foo/i })).toBeVisible()
    // Disabled filter does NOT appear
    await expect(page.getByRole('option', { name: /Disabled Bar/i })).toHaveCount(0)
  })

  test('Selecting "All conversations" sentinel: every row visible', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'atom-1': {
              id: 'atom-1',
              type: 'atom',
              name: 'Hide Foo',
              enabled: true,
              behavior: 'hide',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
          },
          activeId: 'atom-1',
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })
    await page.goto('/')

    await expect(page.getByText('Foo morning')).toHaveCount(0)

    await pickFilter(page, /All conversations/i)

    await expect(page.getByText('Foo morning')).toBeVisible()
    await expect(page.getByText('Bar afternoon')).toBeVisible()
    await expect(page.getByText('Baz evening')).toBeVisible()
  })
})
