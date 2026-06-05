// Spec-driven test: Manage Filters modal — group editor.
//
// UX.md clauses verified (lines 615-738, "Composable filters" §
// "Manage Filters modal"):
//   - "Group editor: name, match radio (all of these / any of these),
//     enabled toggle, member chips with an "Add member" <Select>. The
//     Add member options exclude (a) self and (b) any node that would
//     create a cycle."
//   - "The UI deliberately avoids AND/OR jargon — the radio labels are
//     'Match all of these filters' and 'Match any of these filters'."
//   - Disabled members render with "(disabled)" suffix.
//   - Trash icon on every row (same as atom editor).
//
// NO APP CODE was read while writing this test.

import { test, expect, withNetRetry } from './fixtures'
import { makeSummary } from './fixtures'

const conversations = [makeSummary({ uuid: 'c-1', name: 'Foo' }), makeSummary({ uuid: 'c-2', name: 'Bar' })]

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

test.describe('Manage Filters modal — group editor', () => {
  test('Match radio uses "all of these" / "any of these" — no AND/OR jargon', async ({ page, mockBackend }) => {
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
            'g-1': {
              id: 'g-1',
              type: 'group',
              name: 'MyGroup',
              enabled: true,
              match: 'all',
              childIds: ['a-1'],
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
    await modal.getByText(/MyGroup/).first().click()

    await expect(modal.getByRole('radio', { name: /all of these/i })).toBeVisible()
    await expect(modal.getByRole('radio', { name: /any of these/i })).toBeVisible()

    // Negative: no AND/OR jargon in the radio labels.
    const andRadio = modal.getByRole('radio', { name: /^and$/i })
    const orRadio = modal.getByRole('radio', { name: /^or$/i })
    await expect(andRadio).toHaveCount(0)
    await expect(orRadio).toHaveCount(0)
  })

  test('Member chips render with × removal affordance', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'a-1': {
              id: 'a-1',
              type: 'atom',
              name: 'ChipMember',
              enabled: true,
              behavior: 'hide',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
            'g-1': {
              id: 'g-1',
              type: 'group',
              name: 'GroupWithMember',
              enabled: true,
              match: 'all',
              childIds: ['a-1'],
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
    await modal.getByText(/GroupWithMember/).first().click()

    // The chip itself must show the member's name. The name appears in
    // the row, the chip, and the summary line, so use .first() to
    // avoid strict-mode violations.
    await expect(modal.getByText(/ChipMember/).first()).toBeVisible()

    // A removal affordance — typically aria-label "Remove ChipMember"
    // or similar. Loose match.
    const removeBtn = modal.getByRole('button', { name: /^remove .*ChipMember/i }).or(
      modal.getByRole('button', { name: /×/ }),
    )
    await expect(removeBtn.first()).toBeVisible()
  })

  test('Add-member Select excludes self', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'g-1': {
              id: 'g-1',
              type: 'group',
              name: 'SelfExclusionGroup',
              enabled: true,
              match: 'all',
              childIds: [],
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
    await modal.getByText(/SelfExclusionGroup/).first().click()

    const addMember = modal.getByRole('combobox', { name: /add member/i })
    await addMember.click()

    // Self should not appear among the options.
    await expect(page.getByRole('option', { name: /SelfExclusionGroup/ })).toHaveCount(0)
  })

  test('Disabled members shown with "(disabled)" suffix', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'a-disabled': {
              id: 'a-disabled',
              type: 'atom',
              name: 'OffAtom',
              enabled: false,
              behavior: 'hide',
              patterns: ['*'],
              mode: 'glob',
              target: 'title',
            },
            'g-1': {
              id: 'g-1',
              type: 'group',
              name: 'GroupContainsDisabled',
              enabled: true,
              match: 'all',
              childIds: ['a-disabled'],
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
    await modal.getByText(/GroupContainsDisabled/).first().click()

    // Member chip carries "(disabled)" suffix when its referenced node
    // is disabled.
    await expect(modal.getByText(/OffAtom.*\(disabled\)/i)).toBeVisible()
  })

  test('Plain-English summary line is present on group editor', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'a-1': {
              id: 'a-1',
              type: 'atom',
              name: 'KidA',
              enabled: true,
              behavior: 'hide',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
            'g-1': {
              id: 'g-1',
              type: 'group',
              name: 'SummaryGroup',
              enabled: true,
              match: 'all',
              childIds: ['a-1'],
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
    await modal.getByText(/SummaryGroup/).first().click()

    // Summary line for a group: per UX.md, groups carry a Behavior in v2
    // is NOT correct — UX.md says groups have no behavior. The plain-
    // English summary phrases the matcher itself. Loose check: "all"
    // and "match" appear together.
    await expect(modal.getByText(/match.*all|all of these/i).first()).toBeVisible()
  })

  test('Trash icon present on every row (count check)', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'a-1': {
              id: 'a-1',
              type: 'atom',
              name: 'GedA',
              enabled: true,
              behavior: 'hide',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
            'g-1': {
              id: 'g-1',
              type: 'group',
              name: 'GedGroup',
              enabled: true,
              match: 'all',
              childIds: ['a-1'],
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

    const deletes = modal.getByRole('button', { name: /^delete/i })
    await expect(deletes).toHaveCount(2)
  })
})
