// Spec-driven test: cycle defense for the filter graph.
//
// UX.md clauses verified (lines 615-738, "Composable filters" §
// "Cycle defense"):
//   - "The Add-member <Select> hides candidates that would introduce a
//     cycle, so the editor cannot save a cyclic graph."
//   - "The runtime evaluator carries a visited set; a cycle introduced
//     by manual edit of the prefs file short-circuits to 'no-op' rather
//     than blowing the stack."
//
// NO APP CODE was read while writing this test.

import { test, expect, withNetRetry } from './fixtures'
import { makeSummary } from './fixtures'

const conversations = [
  makeSummary({ uuid: 'c-foo', name: 'Foo' }),
  makeSummary({ uuid: 'c-bar', name: 'Bar' }),
]

async function openModal(page: import('@playwright/test').Page) {
  // Pin to the contract-implicit testid; the migration banner exposes
  // aria-label="Filter update" which would conflict with a /filter/i
  // label fallback in strict-mode locators.
  const picker = page.getByTestId('active-filter-select')
  await picker.click()
  const manageOpt = page.getByRole('option', { name: /manage filters/i }).or(
    page.getByRole('menuitem', { name: /manage filters/i }),
  ).first()
  await expect(manageOpt).toBeVisible()
  await manageOpt.click()
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible()
  return modal
}

test.describe('Cycle defense', () => {
  test('Add-member Select hides cycle candidates', async ({ page, mockBackend }) => {
    // Build group G containing atom A. Then create group G2 containing G.
    // From inside G's editor, adding G2 as a member would close a cycle
    // (G → G2 → G), so G2 must NOT appear in G's Add-member options.
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'a-1': {
              id: 'a-1',
              type: 'atom',
              name: 'AtomA',
              enabled: true,
              behavior: 'hide',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
            'g': {
              id: 'g',
              type: 'group',
              name: 'GroupG',
              enabled: true,
              match: 'all',
              childIds: ['a-1'],
            },
            'g2': {
              id: 'g2',
              type: 'group',
              name: 'GroupG2',
              enabled: true,
              match: 'all',
              childIds: ['g'],
            },
          },
          activeId: null,
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })
    await withNetRetry(page, () => page.goto('/'))
    const modal = await openModal(page)

    await modal.getByText(/^GroupG$/).first().click()

    const addMember = modal.getByRole('combobox', { name: /add member/i })
    await addMember.click()

    // GroupG2 must NOT appear (would create cycle).
    await expect(page.getByRole('option', { name: /GroupG2/ })).toHaveCount(0)
    // GroupG itself also excluded (self).
    await expect(page.getByRole('option', { name: /^GroupG$/ })).toHaveCount(0)
    // AtomA should be available (already a member, but adding it again
    // doesn't create a cycle — its presence here merely confirms the
    // dropdown is populated). Loose check.
    // (Some implementations may dedupe already-added members; that's
    // acceptable. We do NOT assert AtomA's presence here.)
  })

  test('Prefs blob with a manual cycle loads without crash; sidebar still works', async ({ page, mockBackend }) => {
    // Manually construct a cyclic graph: G1 references G2, G2 references G1.
    // Active = G1. Per UX.md the runtime evaluator must short-circuit
    // (treat as no-op / pass) rather than crash.
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'g1': {
              id: 'g1',
              type: 'group',
              name: 'CycleGroup1',
              enabled: true,
              match: 'all',
              childIds: ['g2'],
            },
            'g2': {
              id: 'g2',
              type: 'group',
              name: 'CycleGroup2',
              enabled: true,
              match: 'all',
              childIds: ['g1'],
            },
          },
          activeId: 'g1',
          _migratedV1: true,
          _migratedV2: true,
        },
      },
    })
    await withNetRetry(page, () => page.goto('/'))

    // Sidebar still functional. With a cycle that short-circuits to "passes",
    // every conversation is visible.
    // (Use .first() because the conversation row renders the title and
    // a uuid line; both contain the literal "Foo"/"Bar".)
    await expect(page.getByText('Foo').first()).toBeVisible()
    await expect(page.getByText('Bar').first()).toBeVisible()
  })
})
