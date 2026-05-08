// Spec-driven test: Delete UX for filters.
//
// UX.md clauses verified (lines 615-738, "Composable filters" §
// "Manage Filters modal"):
//   - "Used by: line sits directly under the name input and lists the
//     groups that reference the current filter. Deletion is blocked
//     while the filter is referenced; the block message names the
//     referencing group(s) inline."
//   - Implicit: "Deleting the currently-active filter clears the active
//     selection (no stale activeId)." (per the plan & evaluator
//     contract: stale activeId = no-op).
//
// NO APP CODE was read while writing this test.

import { test, expect } from './fixtures'
import { makeSummary } from './fixtures'

const conversations = [
  makeSummary({ uuid: 'c-foo', name: 'Foo morning' }),
  makeSummary({ uuid: 'c-bar', name: 'Bar afternoon' }),
]

async function openModal(page: import('@playwright/test').Page) {
  const picker = page.getByTestId('active-filter-select').or(page.getByLabel(/filter/i).first())
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

test.describe('Delete UX', () => {
  test('Unreferenced atom: trash → confirm removes the row', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'a-1': {
              id: 'a-1',
              type: 'atom',
              name: 'DeleteMe',
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
    await page.goto('/')
    const modal = await openModal(page)

    const trash = modal.getByRole('button', { name: /^delete/i }).first()
    await expect(trash).toBeVisible()
    await trash.click()

    // An inline confirm appears.
    const confirm = modal.getByRole('button', { name: /^confirm|yes|delete/i }).filter({
      hasNotText: /DeleteMe/,
    })
    // Click the confirm (the one that's not the trash row label).
    // Heuristic: pick the last confirm-style button.
    await confirm.last().click()

    // Row is gone.
    await expect(modal.getByText(/^DeleteMe$/)).toHaveCount(0)
  })

  test('Unreferenced atom: trash → cancel keeps the row', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'a-1': {
              id: 'a-1',
              type: 'atom',
              name: 'KeepMe',
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
    await page.goto('/')
    const modal = await openModal(page)

    const trash = modal.getByRole('button', { name: /^delete/i }).first()
    await trash.click()

    const cancel = modal.getByRole('button', { name: /^cancel/i }).first()
    await expect(cancel).toBeVisible()
    await cancel.click()

    // Row remains.
    await expect(modal.getByText(/KeepMe/)).toBeVisible()
  })

  test('Referenced atom: trash → "Used by:" inline block names the group; deletion blocked', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'a-1': {
              id: 'a-1',
              type: 'atom',
              name: 'AtomUsed',
              enabled: true,
              behavior: 'hide',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
            'g-1': {
              id: 'g-1',
              type: 'group',
              name: 'BlockingGroup',
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
    await page.goto('/')
    const modal = await openModal(page)

    // Find the trash button for AtomUsed specifically.
    const trash = modal.getByRole('button', { name: /^delete .*AtomUsed/i }).or(
      modal.getByRole('button', { name: /^delete/i }).first(),
    )
    await trash.first().click()

    // Inline "Used by:" naming BlockingGroup.
    await expect(modal.getByText(/used by/i)).toBeVisible()
    await expect(modal.getByText(/BlockingGroup/i)).toBeVisible()

    // Atom row remains (deletion blocked).
    await expect(modal.getByText(/AtomUsed/)).toBeVisible()
  })

  test('Deleting the currently-active filter clears active to "All conversations"', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations,
      preferences: {
        filters: {
          nodes: {
            'a-1': {
              id: 'a-1',
              type: 'atom',
              name: 'ActiveDeleteMe',
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
    await page.goto('/')

    // Pre-condition: filter is active. Foo hidden.
    await expect(page.getByText('Foo morning')).toHaveCount(0)

    const modal = await openModal(page)
    const trash = modal.getByRole('button', { name: /^delete/i }).first()
    await trash.click()

    const confirm = modal.getByRole('button', { name: /^confirm|yes|delete/i }).last()
    await confirm.click()

    // Close modal so sidebar is fully visible.
    await page.keyboard.press('Escape')

    // After deletion, active is cleared. Foo should be visible again.
    await expect(page.getByText('Foo morning')).toBeVisible()

    // Picker shows "All conversations".
    const picker = page.getByTestId('active-filter-select').or(page.getByLabel(/filter/i).first())
    await expect(picker).toContainText(/All conversations/i)
  })
})
