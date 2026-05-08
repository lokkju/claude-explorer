// Spec-driven test: trash icon visibility in Manage Filters modal.
//
// UX.md clauses verified (lines 615-738, "Composable filters"):
//   - Manage Filters modal has a row per saved filter on the left list.
//   - Each row exposes a deletable affordance (the "trash icon") matching
//     the contract that "Deletion is blocked while the filter is referenced;
//     the block message names the referencing group(s) inline." That UX
//     requires a per-row delete affordance reachable to the user.
//
// This is the canary regression test for the just-reported drift where
// trash icons disappeared / were clipped off the right edge of the row.
// Three assertions per the plan: toHaveCount(N), toBeVisible(),
// toBeInViewport(). Plus a bounding-box check: dx + dw <= rx + rw + 1.
//
// NO APP CODE was read while writing this test.

import { test, expect } from './fixtures'
import { makeSummary } from './fixtures'

test.describe('Manage Filters modal: trash icon visibility (canary)', () => {
  test('every row exposes a visible, in-viewport delete affordance', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations: [
        makeSummary({ uuid: 'c-1', name: 'Foo conversation' }),
        makeSummary({ uuid: 'c-2', name: 'Bar conversation' }),
      ],
      preferences: {
        filters: {
          nodes: {
            'atom-foo': {
              id: 'atom-foo',
              type: 'atom',
              name: 'Foo filter',
              enabled: true,
              behavior: 'hide',
              patterns: ['*Foo*'],
              mode: 'glob',
              target: 'title',
            },
            'atom-bar': {
              id: 'atom-bar',
              type: 'atom',
              name: 'Bar filter',
              enabled: true,
              behavior: 'show-only',
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

    // Open the Manage Filters modal via the active-filter picker's
    // "Manage filters…" item (per UX.md). The picker lives in the sidebar
    // between the title-search and the source filter (per UX.md Sidebar
    // section).
    const picker = page.getByTestId('active-filter-select').or(page.getByLabel(/filter/i).first())
    await picker.click()
    const manageItem = page.getByRole('option', { name: /manage filters/i }).or(
      page.getByRole('menuitem', { name: /manage filters/i }),
    )
    await expect(manageItem.first()).toBeVisible()
    await manageItem.first().click()

    // Modal opens with the saved filters listed on the left.
    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible()

    // Three explicit assertions on per-row trash affordances:
    const deleteButtons = modal.getByRole('button', { name: /^delete/i })

    // (1) Count: one delete affordance per saved filter row (2 here).
    await expect(deleteButtons).toHaveCount(2)

    // (2) Visible
    await expect(deleteButtons.first()).toBeVisible()
    await expect(deleteButtons.nth(1)).toBeVisible()

    // (3) In viewport (catches CSS-overflow clipping that visibility misses)
    await expect(deleteButtons.first()).toBeInViewport()
    await expect(deleteButtons.nth(1)).toBeInViewport()

    // (4) Bounding-box: button's right edge is within the row's right edge
    // (epsilon for sub-pixel rounding). Find the row container by walking
    // up from the button. We look for the closest ancestor with role=button
    // or a list-item-style container; if neither, fall back to the parent.
    for (let i = 0; i < 2; i++) {
      const btn = deleteButtons.nth(i)
      const dBox = await btn.boundingBox()
      expect(dBox).not.toBeNull()

      // The "row" is the nearest ancestor element. We approximate with the
      // button's parent element via evaluate, since the spec doesn't
      // promise a particular role on the row container.
      const rowBox = await btn.evaluate((el: Element) => {
        let node: Element | null = el.parentElement
        // Walk up at most a few levels to find a meaningful row container
        // (one that is meaningfully wider than the button itself).
        const btnRect = el.getBoundingClientRect()
        while (node) {
          const r = node.getBoundingClientRect()
          if (r.width > btnRect.width * 2) {
            return { x: r.left, y: r.top, width: r.width, height: r.height }
          }
          node = node.parentElement
        }
        return null
      })
      expect(rowBox).not.toBeNull()

      if (dBox && rowBox) {
        const dRight = dBox.x + dBox.width
        const rRight = rowBox.x + rowBox.width
        // Allow 1px epsilon for sub-pixel rounding.
        expect(dRight).toBeLessThanOrEqual(rRight + 1)
      }
    }
  })
})
