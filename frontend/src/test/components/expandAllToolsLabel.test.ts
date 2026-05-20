/**
 * Issue 2 (2026-05-20) — pure label helper for the "Expand/Collapse all
 * tools" header button. Pinning the four-state label table here keeps
 * the implementation simple (the button passes through expandAllTools +
 * isPending) and gives the regression test a stable surface that
 * doesn't require flushing React 19 transitions.
 */

import { describe, it, expect } from 'vitest'

import {
  expandAllToolsButtonLabel,
  computeScrollAnchorAdjustment,
} from '../../components/conversation/expandAllToolsLabel'

describe('expandAllToolsButtonLabel (Issue 2)', () => {
  it('returns "Expand" when collapsed and idle', () => {
    expect(expandAllToolsButtonLabel(false, false)).toBe('Expand')
  })

  it('returns "Collapse" when expanded and idle', () => {
    expect(expandAllToolsButtonLabel(true, false)).toBe('Collapse')
  })

  it('returns "Expanding…" while a collapse→expand transition is pending', () => {
    // isPending fires AFTER startTransition with the NEW value scheduled
    // but before commit; at that instant `expandAllTools` is still the
    // OLD (false) value, so we render "Expanding…".
    expect(expandAllToolsButtonLabel(false, true)).toBe('Expanding…')
  })

  it('returns "Collapsing…" while an expand→collapse transition is pending', () => {
    expect(expandAllToolsButtonLabel(true, true)).toBe('Collapsing…')
  })
})

describe('computeScrollAnchorAdjustment (Issue 3)', () => {
  it('returns 0 when the anchor did not move', () => {
    expect(computeScrollAnchorAdjustment(120, 120)).toBe(0)
  })

  it('ignores sub-pixel layout noise below the threshold', () => {
    expect(computeScrollAnchorAdjustment(120, 120.3)).toBe(0)
    expect(computeScrollAnchorAdjustment(120, 119.7)).toBe(0)
  })

  it('returns the positive delta when expansion pushed the anchor down', () => {
    // Expand-all grew bubbles above the focused message; its new top
    // is 200px farther from the viewport top. scrollTop must increase
    // by 200 to put the focused message back in the same pixel slot.
    expect(computeScrollAnchorAdjustment(150, 350)).toBe(200)
  })

  it('returns the negative delta when collapse pulled the anchor up', () => {
    expect(computeScrollAnchorAdjustment(350, 150)).toBe(-200)
  })

  it('threshold is configurable', () => {
    // 5px change is below a custom 10px threshold → no adjustment.
    expect(computeScrollAnchorAdjustment(100, 105, 10)).toBe(0)
    // 15px change clears the same 10px threshold.
    expect(computeScrollAnchorAdjustment(100, 115, 10)).toBe(15)
  })
})
