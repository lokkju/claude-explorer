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
//
// LESSONS FROM THE PRIOR REGRESSION (2026-05-07): the original canary
// passed even when the trash button was clipped by a Radix ScrollArea
// `overflow: hidden` ancestor. Playwright's `toBeVisible()`,
// `toBeInViewport()`, and a row-anchored bounding-box check are all
// reference-frame-blind to clipping by an inner overflow ancestor —
// they only see the element's own box and the browser viewport. AND
// the prior fixtures used short names ("Foo filter", "Bar filter") so
// the row never overflowed in the first place. Two compounding bugs.
//
// This rewrite fixes both:
//   (a) Use a deliberately LONG filter name that exercises the row-
//       overflow case ("automated run of a scheduled task" — the same
//       length that triggered the user's regression on real prefs).
//   (b) Use `expectInsideClipAncestor()` which walks up to the nearest
//       `overflow: hidden|auto|scroll` ancestor and asserts the
//       element's box fits inside that ancestor's box.
//   (c) Actually `.hover()` the button as a secondary actionability
//       check — clipped content fails actionability in modern browsers.
//
// NO APP CODE was read while writing this test.

import { test, expect, type Locator, withNetRetry } from './fixtures'
import { makeSummary, withNetRetry } from './fixtures'

/**
 * Asserts that `target`'s bounding box is fully contained within the
 * bounding box of its nearest ancestor that has `overflow` set to
 * `hidden | auto | scroll | clip` on either axis. Catches the bug
 * class where an element is "visible" by Playwright's definition but
 * visually clipped by an overflow ancestor.
 *
 * Walks up the ancestor chain in JavaScript via `evaluate`, finds the
 * nearest such ancestor, and returns both rects to the test runner so
 * the assertion can be made with informative failure messages.
 */
async function expectInsideClipAncestor(target: Locator, label: string) {
  const result = await target.evaluate((el: Element) => {
    const targetRect = el.getBoundingClientRect()
    let node: Element | null = el.parentElement
    while (node) {
      const cs = window.getComputedStyle(node)
      const ovX = cs.overflowX
      const ovY = cs.overflowY
      const isClippy = (v: string) =>
        v === 'hidden' || v === 'auto' || v === 'scroll' || v === 'clip'
      if (isClippy(ovX) || isClippy(ovY)) {
        const r = node.getBoundingClientRect()
        return {
          target: { x: targetRect.left, y: targetRect.top, w: targetRect.width, h: targetRect.height },
          ancestor: {
            x: r.left, y: r.top, w: r.width, h: r.height,
            tag: node.tagName,
            cls: typeof node.className === 'string' ? node.className.slice(0, 80) : '',
            overflowX: ovX, overflowY: ovY,
          },
        }
      }
      node = node.parentElement
    }
    return { target: { x: targetRect.left, y: targetRect.top, w: targetRect.width, h: targetRect.height }, ancestor: null }
  })

  expect(result.ancestor, `${label}: no overflow-clipping ancestor found; test setup may be wrong`).not.toBeNull()
  const t = result.target
  const a = result.ancestor!
  const eps = 1
  // x-axis containment
  expect(t.x, `${label}: target.left (${t.x}) < ancestor.left (${a.x}) — clipped on the left by ${a.tag}.${a.cls}`).toBeGreaterThanOrEqual(a.x - eps)
  expect(t.x + t.w, `${label}: target.right (${t.x + t.w}) > ancestor.right (${a.x + a.w}) — clipped on the right by ${a.tag}.${a.cls} (overflow-x: ${a.overflowX})`).toBeLessThanOrEqual(a.x + a.w + eps)
  // y-axis containment
  expect(t.y, `${label}: target.top (${t.y}) < ancestor.top (${a.y}) — clipped on the top by ${a.tag}`).toBeGreaterThanOrEqual(a.y - eps)
  expect(t.y + t.h, `${label}: target.bottom (${t.y + t.h}) > ancestor.bottom (${a.y + a.h}) — clipped on the bottom by ${a.tag} (overflow-y: ${a.overflowY})`).toBeLessThanOrEqual(a.y + a.h + eps)
}

test.describe('Manage Filters modal: trash icon visibility (canary)', () => {
  test('every row exposes a visible, in-viewport, NOT-clipped delete affordance', async ({ page, mockBackend }) => {
    await mockBackend({
      conversations: [
        makeSummary({ uuid: 'c-1', name: 'Foo conversation' }),
        makeSummary({ uuid: 'c-2', name: 'Bar conversation' }),
      ],
      preferences: {
        filters: {
          nodes: {
            // CRITICAL: the long name is what reproduces the row-overflow
            // case. The pre-fix Radix ScrollArea wrapper had
            // `display: table` and grew to fit the longest row's natural
            // width, then the outer `overflow: hidden` clipped the
            // checkbox + trash button on the right. Short names never
            // triggered the wrapper to grow. Don't shorten this.
            'atom-long': {
              id: 'atom-long',
              type: 'atom',
              name: 'automated run of a scheduled task',
              enabled: true,
              behavior: 'hide',
              patterns: ['*scheduled*'],
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

    await withNetRetry(() => page.goto('/'))

    const picker = page.getByTestId('active-filter-select')
    await picker.click()
    const manageItem = page.getByRole('option', { name: /manage filters/i }).or(
      page.getByRole('menuitem', { name: /manage filters/i }),
    )
    await expect(manageItem.first()).toBeVisible()
    await manageItem.first().click()

    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible()

    const deleteButtons = modal.getByRole('button', { name: /^delete/i })

    // (1) Count: one delete affordance per saved filter row (2 here).
    await expect(deleteButtons).toHaveCount(2)

    // (2) Visible (Playwright's bounding-box definition; insufficient on
    //     its own to detect overflow-clipping but still required).
    await expect(deleteButtons.first()).toBeVisible()
    await expect(deleteButtons.nth(1)).toBeVisible()

    // (3) NOT clipped by any `overflow: hidden|auto|scroll|clip` ancestor.
    //     This is the real-rendering check the prior canary missed.
    await expectInsideClipAncestor(deleteButtons.first(), 'delete-button[0]')
    await expectInsideClipAncestor(deleteButtons.nth(1), 'delete-button[1]')

    // (4) Same check for the Enabled checkbox (it sits next to the trash
    //     and was clipped by the same regression).
    const enabledCheckboxes = modal.getByRole('checkbox', { name: /enabled|disabled/i })
    await expect(enabledCheckboxes).toHaveCount(2)
    await expectInsideClipAncestor(enabledCheckboxes.first(), 'enabled-checkbox[0]')
    await expectInsideClipAncestor(enabledCheckboxes.nth(1), 'enabled-checkbox[1]')

    // (5) Actionability: hovering a clipped element fails Playwright's
    //     actionability check. This catches the bug end-to-end as a
    //     genuine "user can't reach this" check.
    await deleteButtons.first().hover({ timeout: 2000 })
    await deleteButtons.nth(1).hover({ timeout: 2000 })
  })
})
